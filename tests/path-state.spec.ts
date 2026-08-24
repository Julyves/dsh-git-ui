import { describe, expect, it } from 'vitest'
import { PathStateTracker, UPGRADE_BUDGET_PER_QUERY, PATH_STATE_CAP, PROBE_COOLDOWN_MS } from '../src/host/path-state.ts'
import { RecordStore } from '../src/host/record-store.ts'
import { runTurnRecords, type TurnRecordSources } from '../src/host/turn-records.ts'
import type { GitChange, GitSnapshot } from '../src/host/types.ts'

describe('PathStateTracker', () => {
  it('returns undefined for unknown paths (assemble layer shows gone)', () => {
    const tracker = new PathStateTracker()
    expect(tracker.get('a.ts')).toBeUndefined()
  })

  it('stores committed/reverted verdicts; committed wins over reverted', () => {
    const tracker = new PathStateTracker()
    tracker.set('a.ts', 'reverted')
    expect(tracker.get('a.ts')).toBe('reverted')
    tracker.set('a.ts', 'committed') // 提交是最终事实
    expect(tracker.get('a.ts')).toBe('committed')
    tracker.set('b.ts', 'committed')
    tracker.set('b.ts', 'reverted') // 不覆盖已提交
    expect(tracker.get('b.ts')).toBe('committed')
  })

  it('enforces per-cycle acquisition budget (storm guard)', () => {
    const tracker = new PathStateTracker()
    expect(tracker.beginCycle(10_000)).toBe(true)
    let acquired = 0
    for (let index = 0; index < UPGRADE_BUDGET_PER_QUERY + 10; index += 1) {
      if (tracker.tryAcquire(`f${index}.ts`)) acquired += 1
    }
    expect(acquired).toBe(UPGRADE_BUDGET_PER_QUERY)
    expect(tracker.remainingBudget()).toBe(0)
    // 新一轮重置配额(越过冷却窗口)
    expect(tracker.beginCycle(70_000)).toBe(true)
    expect(tracker.tryAcquire('f0.ts')).toBe(true) // 新轮可重新探测(attempted 也重置)
    expect(tracker.remainingBudget()).toBe(UPGRADE_BUDGET_PER_QUERY - 1)
  })

  it('does not double-acquire the same path within a cycle', () => {
    const tracker = new PathStateTracker()
    expect(tracker.beginCycle(10_000)).toBe(true)
    expect(tracker.tryAcquire('a.ts')).toBe(true)
    expect(tracker.tryAcquire('a.ts')).toBe(false)
    expect(tracker.tryAcquire('a.ts')).toBe(false)
    expect(tracker.remainingBudget()).toBe(UPGRADE_BUDGET_PER_QUERY - 1)
  })

  it('cooldowns only after an actual probe cycle (rebuild-convergence storm guard)', () => {
    const tracker = new PathStateTracker()
    // 空轮(无 gone 条目):beginCycle 允许,但不启动冷却。
    expect(tracker.beginCycle(10_000)).toBe(true)
    expect(tracker.beginCycle(30_000)).toBe(true) // 无探测轮 → 不冷却
    // 实际探测轮:领取名额并 noteProbeCycle 后,冷却窗口启动。
    expect(tracker.tryAcquire('a.ts')).toBe(true)
    tracker.noteProbeCycle(30_000)
    // 冷却窗口内(20s < 60s):配额归零,探测被抑制。
    expect(tracker.beginCycle(50_000)).toBe(false)
    expect(tracker.tryAcquire('b.ts')).toBe(false)
    expect(tracker.remainingBudget()).toBe(0)
    // 越过冷却(30_000 + 60_100):配额恢复。
    expect(tracker.beginCycle(90_100)).toBe(true)
    expect(tracker.tryAcquire('b.ts')).toBe(true)
  })

  it('restores persisted verdicts without marking dirty; exports entries', () => {
    const tracker = new PathStateTracker()
    tracker.set('a.ts', 'committed')
    tracker.set('b.ts', 'reverted')
    expect(tracker.isDirty).toBe(true)
    // 导出 → 落盘。
    const exported = tracker.entries()
    expect(exported).toContainEqual(['a.ts', 'committed'])
    expect(exported).toContainEqual(['b.ts', 'reverted'])
    tracker.clearDirty()
    expect(tracker.isDirty).toBe(false)
    // 新实例恢复:判定命中、不触发 dirty(恢复不是新判定)。
    const restored = new PathStateTracker()
    restored.restore(exported)
    expect(restored.get('a.ts')).toBe('committed')
    expect(restored.get('b.ts')).toBe('reverted')
    expect(restored.isDirty).toBe(false)
  })

  it('no-ops when re-setting an existing verdict (zero-write discipline)', () => {
    const tracker = new PathStateTracker()
    tracker.set('a.ts', 'committed')
    tracker.clearDirty()
    tracker.set('a.ts', 'committed') // 无变化
    expect(tracker.isDirty).toBe(false)
    tracker.set('b.ts', 'reverted')
    tracker.set('b.ts', 'reverted') // 无变化
    expect(tracker.isDirty).toBe(true) // 仅首个 b.ts 判定置脏
  })

  it('caps stored verdicts (bounded memory)', () => {
    const tracker = new PathStateTracker()
    for (let index = 0; index < PATH_STATE_CAP + 100; index += 1) {
      tracker.set(`f${index}.ts`, 'committed')
    }
    expect(tracker.get(`f0.ts`)).toBeUndefined() // 最旧被裁剪
    expect(tracker.get(`f${PATH_STATE_CAP}.ts`)).toBe('committed')
    expect(tracker.get(`f${PATH_STATE_CAP + 99}.ts`)).toBe('committed')
  })
})

// ── 升级流程集成(turn-records 查询内渐进收敛) ──────────────────────────────

const NOW = 5000

function memoryPersistenceFactory(): (sessionId: string) => { read(): Promise<string | null>; write(raw: string): Promise<void> } {
  const files = new Map<string, string | null>()
  return (sessionId) => ({
    read: async () => files.get(sessionId) ?? null,
    write: async (raw) => { files.set(sessionId, raw) },
  })
}

function snapshotOk(changes: readonly GitChange[]): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false, dirty: true,
    staged: 0, modified: changes.length, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [], changes, truncated: false,
    refreshIntervalMs: 30_000, checkedAt: 4000,
  }
}

import type { TurnEventSlice } from '../src/host/turns.ts'

const events: readonly TurnEventSlice[] = [
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' } },
  { type: 'tool/call', seq: 3, time: 1150, data: { turn: 1, callId: 'c2', name: 'write', arguments: '{"file_path":"b.txt"}' } },
  { type: 'turn/end', seq: 4, time: 2000, data: { turn: 1 } },
]

describe('runTurnRecords path-state upgrade (progressive convergence)', () => {
  it('starts as gone and upgrades to committed/reverted within the query budget', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const tracker = new PathStateTracker()
    let probed = 0
    const sources: TurnRecordSources = {
      sessionEvents: () => events,
      snapshot: async () => ({ ok: true, value: snapshotOk([]) }),
      presenter: undefined,
      mtimes: async () => undefined,
      subagentWrites: async () => new Map(),
      siblingWrites: async () => new Set<string>(),
      probe: () => ({ isCommitted: async () => false }),
      pathStates: () => tracker,
      finalStateProbe: () => ({ finalState: async (path) => { probed += 1; return path === 'a.txt' ? 'committed' : 'reverted' } }),
      now: () => NOW,
    }
    const first = await runTurnRecords(pipeline, sources, 's1')
    if (!first.ok || first.value.kind !== 'turn-records') throw new Error('first failed')
    // 首次查询:探测在组装后、返回前完成——本查询即可看到升级后的状态。
    const internal = new Map(first.value.turns[0]?.internal.map((e) => [e.path, e.state]) ?? [])
    expect(internal.get('a.txt')).toBe('committed')
    expect(internal.get('b.txt')).toBe('reverted')
    expect(probed).toBe(2)
    // 第二次:缓存命中,零探测。
    const second = await runTurnRecords(pipeline, sources, 's1')
    if (!second.ok || second.value.kind !== 'turn-records') throw new Error('second failed')
    const internal2 = new Map(second.value.turns[0]?.internal.map((e) => [e.path, e.state]) ?? [])
    expect(internal2.get('a.txt')).toBe('committed')
    expect(internal2.get('b.txt')).toBe('reverted')
    expect(probed).toBe(2) // 未新增探测
    expect(tracker.get('a.txt')).toBe('committed')
    expect(tracker.get('b.txt')).toBe('reverted')
  })

  it('defers beyond-budget probes to later queries (storm guard at integration level)', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const tracker = new PathStateTracker()
    // 递增时钟:每轮查询越过探测冷却窗口(PROBE_COOLDOWN_MS),聚焦配额本身。
    let now = NOW
    const clock = (): number => { now += PROBE_COOLDOWN_MS + 1; return now }
    const manyCalls: TurnEventSlice[] = Array.from({ length: 40 }, (_, index) => ({
      type: 'tool/call',
      seq: events.length + index + 1,
      time: 1200 + index,
      data: { turn: 1, callId: `c${index}`, name: 'write', arguments: JSON.stringify({ file_path: `f${index}.txt` }) },
    }))
    const bigEvents = [...events.slice(0, 2), ...manyCalls, ...events.slice(2)]
    const probedPaths: string[] = []
    const call = (): Promise<import('../src/host/types.ts').GitQueryResponse> => runTurnRecords(pipeline, {
      sessionEvents: () => bigEvents,
      snapshot: async () => ({ ok: true, value: snapshotOk([]) }),
      presenter: undefined,
      mtimes: async () => undefined,
      subagentWrites: async () => new Map(),
      siblingWrites: async () => new Set<string>(),
      probe: () => ({ isCommitted: async () => false }),
      pathStates: () => tracker,
      finalStateProbe: () => ({ finalState: async (path) => { probedPaths.push(path); return 'committed' } }),
      now: clock,
    }, 's1')
    const first = await call()
    if (!first.ok) throw new Error('failed')
    if (first.value.kind !== 'turn-records') throw new Error('wrong kind')
    // 首轮只探测配额内路径;其余保持 gone。
    const states = new Map(first.value.turns[0]?.internal.map((e) => [e.path, e.state]) ?? [])
    expect(probedPaths.length).toBeLessThanOrEqual(UPGRADE_BUDGET_PER_QUERY)
    expect(probedPaths.length).toBe(UPGRADE_BUDGET_PER_QUERY)
    const probed = new Set(probedPaths)
    const stillGone = [...states.entries()].filter(([, state]) => state === 'gone').map(([path]) => path)
    expect(stillGone.length).toBeGreaterThan(0)
    expect(stillGone.every((path) => !probed.has(path))).toBe(true)
    // 第二轮:剩余 gone 继续探测(去重后预算内),渐进收敛。
    await call()
    const third = await call()
    if (!third.ok || third.value.kind !== 'turn-records') throw new Error('failed')
    const states2 = new Map(third.value.turns[0]?.internal.map((e) => [e.path, e.state]) ?? [])
    const gone2 = [...states2].filter(([, s]) => s === 'gone').length
    expect(gone2).toBeLessThan(stillGone.length)
  })

  it('keeps gone (no probe) when the probe throws or the tracker is absent', async () => {
    const pipeline = new RecordStore(memoryPersistenceFactory(), 0)
    const tracker = new PathStateTracker()
    const result = await runTurnRecords(pipeline, {
      sessionEvents: () => events,
      snapshot: async () => ({ ok: true, value: snapshotOk([]) }),
      presenter: undefined,
      mtimes: async () => undefined,
      subagentWrites: async () => new Map(),
      siblingWrites: async () => new Set<string>(),
      probe: () => ({ isCommitted: async () => false }),
      pathStates: () => tracker,
      finalStateProbe: () => ({ finalState: async () => { throw new Error('boom') } }),
      now: () => NOW,
    }, 's1')
    if (!result.ok || result.value.kind !== 'turn-records') throw new Error('failed')
    expect(result.value.turns[0]?.internal.every((e) => e.state === 'gone')).toBe(true)
    // 探针失败不写入缓存 → 未来轮次仍可重试。
    expect(tracker.get('a.txt')).toBeUndefined()
  })
})