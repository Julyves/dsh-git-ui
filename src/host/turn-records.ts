/**
 * turn-records 查询的业务编排(纯业务层,框架无关)。
 *
 * 流程:会话事件折叠(增量)→ 快照(观测已在适配层随快照更新)→
 * mtime 精修 → 子会话写路径归并 → RecordStore 组装。快照失败时
 * 镜像其错误(统计严格基于 git:git 不可用即无记录可谈)。
 */

import type { RecordStore } from './record-store.ts'
import type { CommitProbe } from './record-store.ts'
import type { GitQueryResponse, GitSnapshot, GitSnapshotFailure, GitSnapshotResult } from './types.ts'
import type { TurnEventSlice } from './turns.ts'
import type { MtimeSource } from './record-assembly.ts'
import type { ToolPresenter } from './write-paths.ts'
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
  /** 子会话写路径(父 turn → 路径;可缺省面)。 */
  subagentWrites(sessionId: string, root: string): Promise<ReadonlyMap<number, readonly string[]>>
  /** 恢复对账探针(按 sessionId 取)。 */
  probe(sessionId: string): CommitProbe
  /** 去向判定缓存(每会话一份;可缺省 = 不升级,全部保持 gone)。 */
  pathStates(sessionId: string): PathStateTracker | undefined
  /** 去向权威探针(git log;可缺省 = 不升级)。 */
  finalStateProbe(sessionId: string): PathStateProbe | undefined
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
  pipeline.ensure(sessionId, sources.probe(sessionId))
  pipeline.fold(sessionId, events)

  const snapshot = await sources.snapshot(sessionId, signal)
  if (!snapshot.ok) return { ok: false, error: toQueryError(snapshot.error) }

  const mtimes = await sources.mtimes(snapshot.value)
  const subagentWrites = await sources.subagentWrites(sessionId, snapshot.value.root)
  const pathStates = sources.pathStates(sessionId)
  const assembleTurns = (): readonly TurnWorkRecord[] => pipeline.assemble(sessionId, {
    changes: snapshot.value.changes,
    repoRoot: snapshot.value.root,
    presenter: sources.presenter,
    mtimes,
    now: sources.now(),
    subagentWrites,
    pathStates,
  })
  const records = assembleTurns()

  // 去向升级:对 gone 条目按配额做权威探测(顺序、有界、防重),
  // 探测完成后**二次组装**——本次查询即可返回升级后的状态(渐进收敛)。
  const upgraded = await upgradeGonePaths(records, sources, sessionId, signal)
  const finalRecords = upgraded > 0 ? assembleTurns() : records
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
  tracker.beginCycle()
  let upgraded = 0
  for (const path of gone) {
    if (signal?.aborted === true) break
    if (tracker.get(path) !== undefined) continue
    if (!tracker.tryAcquire(path)) break // 配额耗尽
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