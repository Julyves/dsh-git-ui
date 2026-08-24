/**
 * turn-records 查询的业务编排(纯业务层,框架无关)。
 *
 * 流程:会话事件折叠(增量)→ 快照(观测已在适配层随快照更新)→
 * mtime 精修 → 子会话写路径归并 → RecordStore 组装。快照失败时
 * 镜像其错误(统计严格基于 git:git 不可用即无记录可谈)。
 *
 * 去向升级(URL 配额护栏):对 gone 条目按 `UPGRADE_BUDGET_PER_QUERY` 配额、
 * `PROBE_COOLDOWN_MS` 冷却做顺序权威探测,探测结果写缓存并**持久化**
 * (`ensurePathStates`/`persistPathStates`)——宿主重启/插件更新后不再从头
 * 收敛,从根源消除"安装即命令风暴"复发(incident 488f678 同款)。
 */

import type { RecordStore } from './record-store.ts'
import type { CommitProbe } from './record-store.ts'
import type { GitQueryResponse, GitSnapshot, GitSnapshotFailure, GitSnapshotResult } from './types.ts'
import type { TurnEventSlice } from './turns.ts'
import type { MtimeSource } from './record-assembly.ts'
import type { ToolPresenter, WritePathDetail } from './write-paths.ts'
import type { PathStateProbe, PathStateTracker } from './path-state.ts'
import type { TurnWorkRecord } from './types.ts'

/** turn-records 编排所需的外部面(全由适配层提供)。 */
export interface TurnRecordSources {
  /** 会话事件切片;undefined = 会话不存在(或宿主不知晓)。 */
  sessionEvents(sessionId: string): readonly TurnEventSlice[] | undefined
  /** 取一次快照(适配层应已在成功后更新观测)。 */
  snapshot(sessionId: string, signal?: AbortSignal): Promise<GitSnapshotResult>
  /** 平台写意图解析面(可缺省)。 */
  presenter: ToolPresenter | undefined
  /** mtime 精修(可缺省)。 */
  mtimes(snapshot: GitSnapshot): Promise<MtimeSource | undefined>
  /** 子会话写路径明细(父 turn → {path, authoritative};可缺省面)。 */
  subagentWrites(sessionId: string, root: string): Promise<ReadonlyMap<number, readonly WritePathDetail[]>>
  /** 其他 dsh 会话(同工作区)写过的路径全集(可缺省 = 空,全落 external)。 */
  siblingWrites(sessionId: string, root: string): Promise<ReadonlySet<string>>
  /**
   * 权威写意图通道(接口缝,L3):上游沙箱若提供 per-turn filesWritten,
   * 该 turn 的 internal 完全以其为准(旁路 presentCall/bash 启发式/args 兜底,
   * attribution 恒 authoritative)。未提供(缺省)→ 现行启发式管线。
   * 上游就绪之日即启发式机器退役为 fallback 之时。
   */
  filesWritten?: (sessionId: string) => Promise<ReadonlyMap<number, readonly string[]> | undefined>
  /** 恢复对账探针(按 sessionId 取)。 */
  probe(sessionId: string): CommitProbe
  /** 去向判定缓存(每会话一份;可缺省 = 不升级,全部保持 gone)。 */
  pathStates(sessionId: string): PathStateTracker | undefined
  /** 去向权威探针(git log;可缺省 = 不升级)。 */
  finalStateProbe(sessionId: string): PathStateProbe | undefined
  /** 恢复判定缓存(宿主重启后从磁盘载入;可缺省 = 不恢复,从头收敛)。 */
  ensurePathStates?(sessionId: string): Promise<unknown>
  /** 持久化判定缓存(有新判定才写;可缺省 = 不落盘)。 */
  persistPathStates?(sessionId: string): Promise<void>
  /** 可注入时钟(测试)。 */
  now(): number
}

/** 执行 turn-records 查询。 */
export async function runTurnRecords(
  pipeline: RecordStore,
  sources: TurnRecordSources,
  sessionId: string,
  signal?: AbortSignal,
): Promise<GitQueryResponse> {
  const events = sources.sessionEvents(sessionId)
  if (events === undefined) {
    return { ok: false, error: { code: 'session-not-found', message: sessionId } }
  }
  // 宿主重启后可恢复已持久化的去向判定——避免"每次更新插件=重新收敛=命令风暴"。
  if (sources.ensurePathStates !== undefined) {
    await sources.ensurePathStates(sessionId)
  }
  pipeline.ensure(sessionId, sources.probe(sessionId))
  pipeline.fold(sessionId, events)

  const snapshot = await sources.snapshot(sessionId, signal)
  if (!snapshot.ok) return { ok: false, error: toQueryError(snapshot.error) }

  const mtimes = await sources.mtimes(snapshot.value)
  const subagentWrites = await sources.subagentWrites(sessionId, snapshot.value.root)
  const siblingWrites = await sources.siblingWrites(sessionId, snapshot.value.root)
  // 作者标签固化(P1-2):live 兄弟写集一次性写入观测时间线(随去抖落盘)——
  // 兄弟会话离场/宿主重启后,已固化的归因不漂移为 external。
  pipeline.markSiblingAuthors(sessionId, [...siblingWrites])
  // 权威写意图(L3 接口缝):提供则旁路启发式(见 TurnRecordSources.filesWritten)。
  const filesWritten = sources.filesWritten === undefined
    ? undefined
    : await sources.filesWritten(sessionId)
  const pathStates = sources.pathStates(sessionId)
  const assembleTurns = (): readonly TurnWorkRecord[] => pipeline.assemble(sessionId, {
    changes: snapshot.value.changes,
    repoRoot: snapshot.value.root,
    presenter: sources.presenter,
    mtimes,
    now: sources.now(),
    subagentWrites,
    siblingWrites,
    ...(filesWritten === undefined ? {} : { filesWrittenByTurn: filesWritten }),
    pathStates,
  })
  const records = assembleTurns()

  // 去向升级:对 gone 条目按配额做权威探测(顺序、有界、防重、冷却),
  // 探测完成后**二次组装**——本次查询即可返回升级后的状态(渐进收敛)。
  const upgraded = await upgradeGonePaths(records, sources, sessionId, signal)
  const finalRecords = upgraded > 0 ? assembleTurns() : records
  // 有新判定才落盘(变化判定;R3 纪律)。
  if (upgraded > 0 && sources.persistPathStates !== undefined) {
    await sources.persistPathStates(sessionId)
  }
  return { ok: true, value: { kind: 'turn-records', turns: finalRecords } }
}

/**
 * 对全部 gone 条目按本轮配额(UPGRADE_BUDGET_PER_QUERY)顺序探测:
 * git log 权威判定 → 写缓存。返回本轮成功升级的数量。
 * 失败/取消的探测保持 gone(下轮继续)。
 */
async function upgradeGonePaths(
  records: readonly TurnWorkRecord[],
  sources: TurnRecordSources,
  sessionId: string,
  signal?: AbortSignal,
): Promise<number> {
  const tracker = sources.pathStates(sessionId)
  const probe = sources.finalStateProbe(sessionId)
  if (tracker === undefined || probe === undefined) return 0
  const gone = new Set<string>()
  for (const turn of records) {
    for (const entry of turn.internal) {
      if (entry.state === 'gone') gone.add(entry.path)
    }
    for (const entry of turn.external) {
      if (entry.state === 'gone') gone.add(entry.path)
    }
  }
  tracker.beginCycle(sources.now())
  if (tracker.remainingBudget() <= 0) return 0 // 冷却期(距上次实际探测 < PROBE_COOLDOWN_MS)
  let upgraded = 0
  let probedAny = false
  for (const path of gone) {
    if (signal?.aborted === true) break
    if (tracker.get(path) !== undefined) continue
    if (!tracker.tryAcquire(path)) break // 配额耗尽
    probedAny = true
    let state: 'committed' | 'reverted' | null = null
    try {
      state = await probe.finalState(path)
    } catch {
      state = null // 探测失败(仓库不可用等):保持待定
    }
    if (state !== null) {
      tracker.set(path, state)
      upgraded += 1
    }
  }
  // 本轮确实做过探测 → 启动冷却窗口(空轮不启动,避免无谓延迟)。
  if (probedAny) tracker.noteProbeCycle(sources.now())
  return upgraded
}

/** 快照失败 → 查询错误(快照码与操作码的并集已在 GitOperationErrorCode 中)。 */
function toQueryError(failure: GitSnapshotFailure): Extract<GitQueryResponse, { ok: false }>['error'] {
  switch (failure.code) {
    case 'session-not-found':
    case 'cwd-unavailable':
    case 'not-a-git-repo':
    case 'timeout':
      return { code: failure.code }
    case 'path-not-found':
      return { code: 'path-not-found', message: failure.path }
    case 'git-unavailable':
      return { code: 'git-unavailable', message: failure.detail }
  }
}