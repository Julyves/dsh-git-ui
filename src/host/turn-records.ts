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
  const records = pipeline.assemble(sessionId, {
    changes: snapshot.value.changes,
    repoRoot: snapshot.value.root,
    presenter: sources.presenter,
    mtimes,
    now: sources.now(),
    subagentWrites,
  })
  return { ok: true, value: { kind: 'turn-records', turns: records } }
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