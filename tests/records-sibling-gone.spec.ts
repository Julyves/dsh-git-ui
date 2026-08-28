/**
 * 记录页 host 侧缺陷复现（bug-hunt 第三轮 2026-08-26）。
 *
 * R-AH（中，已修复）：upgradeGonePaths 曾只遍历 turn.internal 与
 * turn.external——sibling 组的 gone 条目永不被权威探测升级。现在三方
 * 作者同等进入探测候选（回归锁）。
 *
 * 验证方式：runTurnRecords 端到端（内存持久化 + 桩 sources）——
 * 对照组（external 条目）能升级为 committed，sibling 组同场景不能。
 */
import { describe, expect, it } from 'vitest'
import { RecordStore } from '../src/host/record-store.ts'
import { runTurnRecords, type TurnRecordSources } from '../src/host/turn-records.ts'
import { PathStateTracker } from '../src/host/path-state.ts'
import type { TurnEventSlice } from '../src/host/turns.ts'
import type { GitChange, GitSnapshot } from '../src/host/types.ts'

const T0 = 1_700_000_000_000

function events(): readonly TurnEventSlice[] {
  return [
    { type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } },
    { type: 'tool/call', seq: 1, time: T0 + 100, data: { turn: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
    { type: 'turn/end', seq: 2, time: T0 + 2000, data: { turn: 1 } },
  ]
}

function snap(root: string): GitSnapshot {
  return {
    root, branch: 'main', head: 'abc', unborn: false, dirty: false,
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [], changes: [], truncated: false,
    refreshIntervalMs: 30_000, watchVersion: 0, checkedAt: T0 + 5000,
  }
}

function change(path: string): GitChange {
  return { path, status: 'modified', staged: false, isDirectory: false }
}

interface RunResult {
  readonly state: string
  readonly probed: readonly string[]
}

/** 场景：s.txt 在 turn1 窗口内被观测到（siblingWrites 命中 → sibling 组），
 * 随后离开工作区（gone）。finalStateProbe 权威返回 committed。 */
async function runScenario(siblingHasPath: boolean): Promise<RunResult> {
  const memory = new Map<string, string>()
  const store = new RecordStore(
    (id) => ({
      read: async () => memory.get('obs:' + id) ?? null,
      write: async (raw: string) => { memory.set('obs:' + id, raw) },
    }),
  )
  const sessionId = 's1'
  store.ensure(sessionId, { isCommitted: async () => false })
  store.fold(sessionId, events())
  // 观测：s.txt 出现在窗口内，随后消失。
  store.observe(sessionId, [change('s.txt')], T0 + 500)
  store.observe(sessionId, [], T0 + 3000)

  const tracker = new PathStateTracker()
  const probed: string[] = []
  const sources: TurnRecordSources = {
    sessionEvents: () => events(),
    snapshot: async () => ({ ok: true, value: snap('/repo') }),
    presenter: undefined,
    mtimes: async () => undefined,
    subagentWrites: async () => new Map(),
    siblingWrites: async () => (siblingHasPath ? new Set(['s.txt']) : new Set<string>()),
    probe: () => ({ isCommitted: async () => false }),
    pathStates: () => tracker,
    finalStateProbe: () => ({
      finalState: async (path: string) => { probed.push(path); return 'committed' },
    }),
    now: () => T0 + 10_000,
  }
  const outcome = await runTurnRecords(store, sources, sessionId)
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw new Error('unreachable')
  const turns = outcome.value.kind === 'turn-records' ? outcome.value.turns : []
  const turn1 = turns.find((r) => r.turn === 1)
  const group = siblingHasPath ? turn1?.sibling : turn1?.external
  return { state: group?.[0]?.state ?? 'missing', probed }
}

describe('turn-records — sibling 组 gone 条目从不升级（R-AH）', () => {
  it('对照组：external 组的 gone 条目被探测升级为 committed（证明探测链路本身工作）', async () => {
    const result = await runScenario(false)
    // eslint-disable-next-line no-console
    console.log(`[R-AH-control] external state=${result.state} probed=${JSON.stringify(result.probed)}`)
    expect(result.state).toBe('committed')
    expect(result.probed).toContain('s.txt')
  })

  it('R-AH(回归锁): sibling 组的 gone 条目与 external 同等被探测升级', async () => {
    const result = await runScenario(true)
    // eslint-disable-next-line no-console
    console.log(`[R-AH] sibling state=${result.state} probed=${JSON.stringify(result.probed)}`)
    // 期望行为：与 external 同等升级为 committed。当前实现 state='gone'、
    // probed 不含 s.txt → FAIL（upgradeGonePaths 漏遍历 sibling 组）。
    expect(result.state).toBe('committed')
    expect(result.probed).toContain('s.txt')
  })
})
