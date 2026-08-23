import { describe, expect, it } from 'vitest'
import { RecordStore } from '../src/host/record-store.ts'
import { runTurnRecords, type TurnRecordSources } from '../src/host/turn-records.ts'
import type { GitSnapshot, GitSnapshotResult } from '../src/host/types.ts'
import type { TurnEventSlice } from '../src/host/turns.ts'
import type { MtimeSource } from '../src/host/record-assembly.ts'

const NOW = 5000

function memoryPersistenceFactory(): (sessionId: string) => { read(): Promise<string | null>; write(raw: string): Promise<void> } {
  const files = new Map<string, string | null>()
  return (sessionId) => ({
    read: async () => files.get(sessionId) ?? null,
    write: async (raw) => { files.set(sessionId, raw) },
  })
}

function snapshotOk(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false, dirty: true,
    staged: 0, modified: 1, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [],
    changes: [{ path: 'ext.txt', status: 'modified', staged: false, isDirectory: false }],
    truncated: false, refreshIntervalMs: 30_000, checkedAt: 4000,
    ...overrides,
  }
}

const events: readonly TurnEventSlice[] = [
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' } },
  { type: 'turn/end', seq: 3, time: 2000, data: { turn: 1 } },
]

function sources(overrides: Partial<TurnRecordSources> = {}): TurnRecordSources {
  return {
    sessionEvents: () => events,
    snapshot: async () => ({ ok: true, value: snapshotOk() }),
    presenter: undefined,
    mtimes: async () => undefined,
    subagentWrites: async () => new Map(),
    probe: () => ({ isCommitted: async () => false }),
    pathStates: () => undefined,
    finalStateProbe: () => undefined,
    now: () => NOW,
    ...overrides,
  }
}

describe('runTurnRecords', () => {
  it('returns session-not-found when the session has no events', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const result = await runTurnRecords(pipeline, sources({ sessionEvents: () => undefined }), 's1')
    expect(result).toEqual({ ok: false, error: { code: 'session-not-found', message: 's1' } })
  })

  it('mirrors snapshot failures as query errors', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const result = await runTurnRecords(pipeline, sources({
      snapshot: async (): Promise<GitSnapshotResult> => ({ ok: false, error: { code: 'not-a-git-repo' } }),
    }), 's1')
    expect(result).toEqual({ ok: false, error: { code: 'not-a-git-repo' } })
  })

  it('mirrors git-unavailable with the detail message', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const result = await runTurnRecords(pipeline, sources({
      snapshot: async (): Promise<GitSnapshotResult> => ({ ok: false, error: { code: 'git-unavailable', detail: 'spawn failed' } }),
    }), 's1')
    expect(result).toEqual({ ok: false, error: { code: 'git-unavailable', message: 'spawn failed' } })
  })

  it('assembles internal + external records end-to-end', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    // 观测时间线由适配层随快照更新(本测试直接预置:firstSeen 1500 ∈ turn1 窗口)。
    pipeline.ensure('s1', { isCommitted: async () => false })
    pipeline.fold('s1', events)
    pipeline.observe('s1', [{ path: 'ext.txt', status: 'modified', staged: false, isDirectory: false }], 1500)
    const result = await runTurnRecords(pipeline, sources(), 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('turn-records')
    if (result.value.kind !== 'turn-records') return
    expect(result.value.turns).toHaveLength(1)
    const turn = result.value.turns[0]
    expect(turn).toBeDefined()
    if (turn === undefined) return
    expect(turn).toMatchObject({ turn: 1, startAt: 1000, endAt: 2000, hasWork: true })
    expect(turn.internal.map((e) => e.path)).toEqual(['a.txt'])
    expect(turn.internal[0]?.state).toBe('gone') // a.txt 不在 changes 且无证据:待定
    expect(turn.external.map((e) => e.path)).toEqual(['ext.txt'])
    expect(turn.external[0]?.state).toBe('dirty')
  })

  it('passes through subagent writes and mtime refinement', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const mtimes: MtimeSource = { mtime: () => 1500 }
    const result = await runTurnRecords(pipeline, sources({
      mtimes: async () => mtimes,
      subagentWrites: async () => new Map([[1, ['sub/x.ts']]]),
      snapshot: async () => ({ ok: true, value: snapshotOk({ changes: [
        { path: 'ext.txt', status: 'modified', staged: false, isDirectory: false },
        { path: 'sub/x.ts', status: 'added', staged: false, isDirectory: false },
      ] }) }),
    }), 's1')
    if (!result.ok) return
    if (result.value.kind !== 'turn-records') return
    const turn = result.value.turns[0]
    expect(turn).toBeDefined()
    if (turn === undefined) return
    expect(turn.internal.map((e) => e.path)).toEqual(['a.txt', 'sub/x.ts'])
    expect(turn.internal.find((e) => e.path === 'sub/x.ts')?.state).toBe('dirty')
  })

  it('is idempotent across repeated calls (incremental fold)', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    await runTurnRecords(pipeline, sources(), 's1')
    const second = await runTurnRecords(pipeline, sources(), 's1')
    if (!second.ok) return
    if (second.value.kind !== 'turn-records') return
    expect(second.value.turns).toHaveLength(1)
    expect(second.value.turns[0]?.internal).toHaveLength(1)
  })
})