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

describe('assembleAll — dual-source path dedup', () => {
  it('merges absolute meta paths with relative presenter paths (no duplicate entries)', () => {
    // 回归:dsb write/edit 的 tool/result meta 直接投影模型入参 args.file_path
    // (常为绝对路径),presentCall 的 locations 同源——两路若不归一化,
    // 同文件会以绝对/相对两个字符串录入,产出一条「已提交」+一条「仍变更」。
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"/repo/docs/test.txt"}' } },
      {
        type: 'tool/result',
        seq: 3,
        time: 1200,
        data: { turn: 1, callId: 'c1', meta: { diffs: [{ path: '/repo/docs/test.txt', oldText: null, newText: 'x' }] } },
      },
      { type: 'turn/end', seq: 4, time: 2000, data: { turn: 1 } },
    ])
    const observations = new ObservationLog()
    const presenter: ToolPresenter = presenterOf({
      card: 'diff',
      diffs: [{ path: '/repo/docs/test.txt' }],
      locations: [{ path: '/repo/docs/test.txt' }],
    })
    const records = assembleAll({
      log,
      observations,
      changes: [change('docs/test.txt')],
      repoRoot: '/repo',
      presenter,
      mtimes: undefined,
      now: 5000,
    })
    expect(records[0]?.internal.map((e) => e.path)).toEqual(['docs/test.txt'])
  })
})

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

  it('labels vanished non-committed agent writes as gone (pending authority)', () => {
    const { log, deps } = fixture()
    // test.txt 不在 changes 且无提交证据:去向待定 → 中性态 gone(不再断言已还原)。
    const observations2 = new ObservationLog()
    observations2.update([change('external.txt')], 1500)
    const records = assembleAll({ log, observations: observations2, ...deps, changes: [change('external.txt')] })
    expect(records[0]?.internal[0]).toMatchObject({ state: 'gone' })
  })

  it('attributes reverted only after an authoritative probe says so', () => {
    const { log, deps } = fixture()
    const observations2 = new ObservationLog()
    observations2.update([change('external.txt')], 1500)
    const records = assembleAll({
      log, observations: observations2, ...deps,
      changes: [change('external.txt')],
      pathStates: { get: (path) => path === 'docs/test.txt' ? 'reverted' : undefined },
    })
    expect(records[0]?.internal[0]).toMatchObject({ state: 'reverted' })
  })

  it('prefers committed evidence over a stale reverted verdict', () => {
    const { log, deps } = fixture()
    const observations2 = new ObservationLog()
    // HEAD 检测证据:committed 是最终事实,覆盖探测的 reverted 缓存。
    observations2.update([change('docs/test.txt')], 1500)
    observations2.markCommitted(['docs/test.txt'], 1600)
    const records = assembleAll({
      log, observations: observations2, ...deps,
      changes: [],
      pathStates: { get: () => 'reverted' },
    })
    expect(records[0]?.internal[0]).toMatchObject({ state: 'committed' })
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
    const { log, deps } = fixture()
    // firstSeen 早于窗口(重启前),但 mtime 落在窗口内 → 归入该 turn
    const observations2 = new ObservationLog()
    observations2.update([change('ideal.ts')], 500) // firstSeen 早于 turn1 窗口起点
    const mtimes: MtimeSource = { mtime: () => 1500 }
    const records = assembleAll({ log, observations: observations2, ...deps, mtimes, changes: [change('ideal.ts')] })
    expect(records[0]?.external.map((e) => e.path)).toEqual(['ideal.ts'])
  })

  it('excludes mtime hits outside the window', () => {
    const { log, deps } = fixture()
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
      subagentWrites: new Map([[1, [{ path: 'sub/written.ts', authoritative: true }]]]),
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
describe('assembleAll — 归因置信度(B3)', () => {
  it('diff-card writes are authoritative; args-fallback and observed entries are inferred', () => {
    const { log, observations, deps } = fixture()
    // fixture presenter = diff 卡 → 权威。
    const records = assembleAll({ log, observations, ...deps })
    expect(records[0]?.internal.find((e) => e.path === 'docs/test.txt')?.attribution).toBe('authoritative')
    // 观测条目(external)恒 inferred。
    expect(records[0]?.external[0]?.attribution).toBe('inferred')
    // 无 presenter:write 走 args 兜底目录 → inferred。
    const bareLog = new TurnLog()
    bareLog.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"docs/test.txt"}' } },
    ])
    const bare = assembleAll({
      log: bareLog, observations,
      changes: [change('docs/test.txt'), change('external.txt')], repoRoot: '/repo', presenter: undefined, mtimes: undefined, now: 2000,
    })
    expect(bare[0]?.internal.find((e) => e.path === 'docs/test.txt')?.attribution).toBe('inferred')
  })

  it('result-meta diffs mark their paths authoritative', () => {
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"src/meta.ts"}' } },
      { type: 'tool/result', seq: 3, time: 1200, data: { turn: 1, callId: 'c1', meta: { diffs: [{ path: '/repo/src/meta.ts' }] } } },
    ])
    const observations = new ObservationLog()
    observations.update([change('src/meta.ts')], 1500)
    const records = assembleAll({
      log, observations,
      changes: [change('src/meta.ts')], repoRoot: '/repo', presenter: undefined, mtimes: undefined, now: 2000,
    })
    expect(records[0]?.internal.find((e) => e.path === 'src/meta.ts')?.attribution).toBe('authoritative')
  })
})

describe('assembleAll — L3 filesWritten 权威旁路', () => {
  it('a turn with filesWritten bypasses heuristics entirely and is authoritative', () => {
    const { log, observations, deps } = fixture()
    // turn 1 命中权威通道(声明集与启发式提取结果不同,验证旁路生效)。
    const records = assembleAll({
      log, observations, ...deps,
      filesWrittenByTurn: new Map([[1, ['sandbox/authoritative.ts']]]),
    })
    const turn1 = records[0]
    expect(turn1?.internal.map((e) => e.path)).toEqual(['sandbox/authoritative.ts'])
    expect(turn1?.internal[0]?.attribution).toBe('authoritative')
    // 未命中的 turn 2 走现行管线(fixture 的 write/diff 提取照常)。
    const turn2 = records[1]
    expect(turn2?.internal.map((e) => e.path)).toEqual(['docs/test.txt'])
  })
})

describe('assembleAll — L4 fresh 标记(指纹派生)', () => {
  it('marks entries absent from the previous turn boundary fingerprint as fresh', () => {
    const { log, observations, deps } = fixture()
    const records = assembleAll({
      log, observations, ...deps,
      fingerprints: new Map([[1, new Set(['docs/test.txt'])]]),
    })
    // turn 2(上一个是 turn 1):docs/test.txt 在边界指纹中 → 非 fresh;
    // turn 1 是首个 turn(无前边界)→ 恒非 fresh。
    const turn2Internal = records[1]?.internal.find((e) => e.path === 'docs/test.txt')
    expect(turn2Internal?.fresh).toBeUndefined()
    const turn1Internal = records[0]?.internal.find((e) => e.path === 'docs/test.txt')
    expect(turn1Internal?.fresh).toBeUndefined()
    // 反例:边界指纹不含该路径 → fresh。
    const records2 = assembleAll({
      log, observations, ...deps,
      fingerprints: new Map([[1, new Set<string>()]]),
    })
    expect(records2[1]?.internal.find((e) => e.path === 'docs/test.txt')?.fresh).toBe(true)
  })
})

describe('assembleAll — 间隙归属(P2-3 真空修复)', () => {
  it('changes first seen in the inter-turn gap land on the NEXT turn', () => {
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' } },
      { type: 'turn/end', seq: 3, time: 2000, data: { turn: 1 } },
      { type: 'turn/start', seq: 4, time: 4000, data: { turn: 2 } },
      { type: 'tool/call', seq: 5, time: 4100, data: { turn: 2, callId: 'c2', name: 'write', arguments: '{"file_path":"b.txt"}' } },
    ])
    const observations = new ObservationLog()
    // gap.txt 首见于间隙 (2000, 4000) → 旧实现任何 turn 都不可见。
    observations.update([change('gap.txt'), change('in2.txt')], 3000)
    const records = assembleAll({
      log, observations,
      changes: [change('gap.txt'), change('in2.txt')], repoRoot: '/repo',
      presenter: undefined, mtimes: undefined, now: 5000,
    })
    expect(records[0]?.external.map((e) => e.path)).toEqual([]) // turn 1 不含间隙条目
    expect(records[1]?.external.map((e) => e.path)).toEqual(['gap.txt', 'in2.txt']) // 归下一 turn
  })

  it('first turn keeps its own startAt (no pre-history vacuum)', () => {
    const log = new TurnLog()
    log.append([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{}' } },
    ])
    const observations = new ObservationLog()
    observations.update([change('early.txt')], 500) // 早于首个 turn:仍不可见(无归属)
    const records = assembleAll({
      log, observations,
      changes: [], repoRoot: '/repo', presenter: undefined, mtimes: undefined, now: 5000,
    })
    expect(records[0]?.external).toEqual([])
  })
})
