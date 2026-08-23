import { describe, expect, it } from 'vitest'
import { TurnLog } from '../src/host/turns.ts'
import { ObservationLog } from '../src/host/observation.ts'
import { assembleAll, type AssembleDeps, type MtimeSource } from '../src/host/record-assembly.ts'
import { type ToolPresenter, type ToolViewSlice } from '../src/host/write-paths.ts'
import type { GitChange } from '../src/host/types.ts'

function change(path: string, status: GitChange['status'] = 'modified'): GitChange {
  return { path, status, staged: false, isDirectory: false }
}

function presenterOf(view: ToolViewSlice): ToolPresenter {
  return { presentCall: () => view }
}

const writePresenter: ToolPresenter = presenterOf({
  card: 'diff',
  diffs: [{ path: 'docs/test.txt' }],
  locations: [{ path: 'docs/test.txt' }],
})

interface Fixture {
  log: TurnLog
  observations: ObservationLog
  deps: Omit<AssembleDeps, 'log' | 'observations'>
}

/** 标准 fixture:turn 1 有工具调用,窗口 [1000, 2000];turn 2 running 从 3000 起。 */
function fixture(overrides: { mtimes?: MtimeSource | undefined } = {}): Fixture {
  const log = new TurnLog()
  log.append([
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{}' } },
    { type: 'turn/end', seq: 3, time: 2000, data: { turn: 1 } },
    { type: 'turn/start', seq: 4, time: 3000, data: { turn: 2 } },
    { type: 'tool/call', seq: 5, time: 3100, data: { turn: 2, callId: 'c2', name: 'write', arguments: '{}' } },
  ])
  const observations = new ObservationLog()
  observations.update([change('docs/test.txt'), change('external.txt')], 1500)
  observations.markCommitted(['docs/test.txt'], 3500)
  const deps: Omit<AssembleDeps, 'log' | 'observations'> = {
    changes: [change('external.txt')],
    repoRoot: '/repo',
    presenter: writePresenter,
    mtimes: overrides.mtimes,
    now: 5000,
  }
  return { log, observations, deps }
}

describe('assembleAll — internal attribution', () => {
  it('marks agent-written paths as internal of their turn', () => {
    const { log, observations, deps } = fixture()
    const records = assembleAll({ log, observations, ...deps })
    expect(records).toHaveLength(2)
    const first = records[0]
    expect(first?.turn).toBe(1)
    expect(first?.hasWork).toBe(true)
    expect(first?.internal.map((e) => e.path)).toEqual(['docs/test.txt'])
    // 已提交的 agent 写入:记录三态 → committed(不再黄色 dirty)
    expect(first?.internal[0]).toMatchObject({ state: 'committed', status: 'modified' })
  })

  it('labels still-dirty agent writes as dirty', () => {
    const { log, observations, deps } = fixture()
    observations.markCommitted([], 0) // 清除提交标注
    // 手动构造:test.txt 仍在 changes
    const records = assembleAll({ log, observations, ...deps, changes: [change('docs/test.txt'), change('external.txt')] })
    expect(records[0]?.internal[0]).toMatchObject({ state: 'dirty', status: 'modified' })
  })

  it('labels vanished non-committed agent writes as reverted', () => {
    const { log, observations, deps } = fixture()
    // test.txt 不在 changes 且无 committedAt(清除 markCommitted 的影响:重建观测)
    const observations2 = new ObservationLog()
    observations2.update([change('external.txt')], 1500)
    const records = assembleAll({ log, observations: observations2, ...deps, changes: [change('external.txt')] })
    expect(records[0]?.internal[0]).toMatchObject({ state: 'reverted' })
  })

  it('treats an agent rewrite of an old file as internal of the new turn', () => {
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 2000, data: { turn: 1 } },
      { type: 'turn/start', seq: 3, time: 3000, data: { turn: 2 } },
      { type: 'tool/call', seq: 4, time: 3100, data: { turn: 2, callId: 'c1', name: 'write', arguments: '{"file_path":"old.ts"}' } },
    ])
    const observations = new ObservationLog()
    observations.update([change('old.ts')], 1200) // 外部先写(旧)
    const records = assembleAll({
      log, observations,
      changes: [change('old.ts')],
      repoRoot: '/repo', presenter: undefined, mtimes: undefined, now: 5000,
    })
    expect(records[1]?.internal.map((e) => e.path)).toEqual(['old.ts'])
    expect(records[0]?.external.map((e) => e.path)).not.toContain('old.ts')
  })
})

describe('assembleAll — external attribution', () => {
  it('attributes observed firstSeen in a window to that turn, excluded when internal', () => {
    const { log, observations, deps } = fixture()
    const records = assembleAll({ log, observations, ...deps })
    // external.txt firstSeen 1500 ∈ turn1 窗口 [1000,2000] → turn1 external
    expect(records[0]?.external.map((e) => e.path)).toEqual(['external.txt'])
    expect(records[0]?.external[0]).toMatchObject({ state: 'dirty', status: 'modified' })
    // turn2 窗口 [3000,now]:external.txt 不在窗口内 → 无
    expect(records[1]?.external).toEqual([])
    // test.txt 由 agent 写 → 永不 external
    expect(records[0]?.external.map((e) => e.path)).not.toContain('docs/test.txt')
  })

  it('uses mtime to attribute still-dirty files into the window (restart retro-fit)', () => {
    const { log, observations, deps } = fixture()
    // firstSeen 早于窗口(重启前),但 mtime 落在窗口内 → 归入该 turn
    const observations2 = new ObservationLog()
    observations2.update([change('ideal.ts')], 500) // firstSeen 早于 turn1 窗口起点
    const mtimes: MtimeSource = { mtime: () => 1500 }
    const records = assembleAll({ log, observations: observations2, ...deps, mtimes, changes: [change('ideal.ts')] })
    expect(records[0]?.external.map((e) => e.path)).toEqual(['ideal.ts'])
  })

  it('excludes mtime hits outside the window', () => {
    const { log, observations, deps } = fixture()
    const observations2 = new ObservationLog()
    observations2.update([change('old.ts')], 500)
    const mtimes: MtimeSource = { mtime: () => 2500 } // 窗口 [1000,2000] 之外
    const records = assembleAll({ log, observations: observations2, ...deps, mtimes })
    expect(records[0]?.external).toEqual([])
  })

  it('includes vanished external entries with committed/reverted state', () => {
    const { log, observations, deps } = fixture()
    observations.markCommitted(['external.txt'], 1600)
    const records = assembleAll({ log, observations, ...deps, changes: [] })
    expect(records[0]?.external[0]).toMatchObject({ state: 'committed' })
  })

  it('does not count changes observed after the turn window into past turns', () => {
    const { log, observations, deps } = fixture()
    observations.update([change('later.ts')], 4500) // turn1 ended 2000;turn2 running from 3000
    const records = assembleAll({ log, observations, ...deps })
    expect(records[0]?.external.map((e) => e.path)).not.toContain('later.ts')
    expect(records[1]?.external.map((e) => e.path)).toEqual(['later.ts'])
  })
})

describe('assembleAll — subagent writes and empty turns', () => {
  it('attributes subagent writes to the parent turn', () => {
    const { log, observations, deps } = fixture()
    const records = assembleAll({
      log, observations, ...deps,
      subagentWrites: new Map([[1, ['sub/written.ts']]]),
      changes: [change('external.txt'), change('sub/written.ts')],
    })
    expect(records[0]?.internal.map((e) => e.path)).toEqual(['docs/test.txt', 'sub/written.ts'])
  })

  it('emits empty turns with hasWork false and no entries', () => {
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 2000, data: { turn: 1 } },
    ])
    const records = assembleAll({
      log, observations: new ObservationLog(), changes: [],
      repoRoot: '/repo', presenter: undefined, mtimes: undefined, now: 3000,
    })
    expect(records[0]).toMatchObject({ turn: 1, hasWork: false, internal: [], external: [] })
  })
})