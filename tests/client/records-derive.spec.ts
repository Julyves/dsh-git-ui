/**
 * 时段聚合派生（src/client/records/derive.ts）单元测试。
 * 纯函数、无 I/O：直接构造 TurnWorkRecord 字面量验证聚合规则边界。
 */
import { describe, expect, it } from 'vitest'
import { buildSessions, summarizeSessions, SESSION_GAP_MS, type WorkSession } from '../../src/client/records/derive.ts'
import type { TurnWorkRecord, WorkEntry } from '../../src/host/types.ts'

/** 构造一个有工作的 turn（时间窗 [start, end]，内部/外部条目数可指定）。 */
function workTurn(turn: number, startAt: number, endAt: number | null, internal = 0, external = 0): TurnWorkRecord {
  const entry = (i: number): WorkEntry => ({
    path: `path-${turn}-${i}.ts`,
    status: 'modified',
    state: 'dirty',
    firstSeenAt: startAt,
  })
  return {
    turn,
    startAt,
    endAt,
    hasWork: true,
    internal: Array.from({ length: internal }, (_, i) => entry(i)),
    external: Array.from({ length: external }, (_, i) => entry(i)),
  }
}

/** 空闲 turn（无工具调用）。 */
function idleTurn(turn: number, startAt: number, endAt: number | null): TurnWorkRecord {
  return { turn, startAt, endAt, hasWork: false, internal: [], external: [] }
}

/** 校验时段窗口与计数。 */
function expectSession(session: WorkSession, turn: number, turnCount: number, internal: number, external: number, endAt: number | null): void {
  expect(session.turn).toBe(turn)
  expect(session.turnCount).toBe(turnCount)
  expect(session.internal).toHaveLength(internal)
  expect(session.external).toHaveLength(external)
  expect(session.endAt).toBe(endAt)
}

describe('buildSessions — 时段聚合', () => {
  it('null / 空输入 → 空列表', () => {
    expect(buildSessions(null)).toEqual([])
    expect(buildSessions([])).toEqual([])
  })

  it('全部空闲 turn → 空列表（idle 不产生时段）', () => {
    const records = [idleTurn(1, 1000, 2000), idleTurn(2, 3000, 4000)]
    expect(buildSessions(records)).toEqual([])
  })

  it('单个有工作 turn → 单时段', () => {
    const records = [workTurn(3, 1000, 2000, 2, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(1)
    expectSession(sessions[0]!, 3, 1, 2, 1, 2000)
  })

  it('间隔 <= 阈值 → 合并为一时段（endAt 顺延取更晚）', () => {
    // turn 1 结束 2000，turn 2 开始 2010 → 间隔 10ms <= 阈值 → 合并
    const records = [workTurn(1, 1000, 2000, 1, 0), workTurn(2, 2010, 3000, 2, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(1)
    expectSession(sessions[0]!, 1, 2, 3, 1, 3000)
    expect(sessions[0]!.startAt).toBe(1000)
  })

  it('间隔恰好等于阈值 → 合并（<= 边界）', () => {
    const gap = SESSION_GAP_MS
    const records = [workTurn(1, 0, 1000), workTurn(2, 1000 + gap, 2000 + gap)]
    expect(buildSessions(records)).toHaveLength(1)
  })

  it('间隔超过阈值 → 拆分为两个时段', () => {
    const gap = SESSION_GAP_MS
    const records = [workTurn(1, 0, 1000), workTurn(2, 1000 + gap + 1, 2000 + gap)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(2)
    expectSession(sessions[0]!, 1, 1, 0, 0, 1000)
    expectSession(sessions[1]!, 2, 1, 0, 0, 2000 + gap)
  })

  it('进行中的 turn（endAt null）并入时段后时段为进行中，其后不再合并', () => {
    // turn 1 running（无 endAt）→ 时段 running；turn 2 出现在其后（防御）→ 新时段
    const records = [workTurn(1, 1000, null, 1), workTurn(2, 1500, 2000, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.endAt).toBeNull()
    expect(sessions[1]!.endAt).toBe(2000)
  })

  it('新 turn 为进行中时，合并后时段为进行中（endAt null 优先）', () => {
    const records = [workTurn(1, 1000, 2000), workTurn(2, 2050, null, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.endAt).toBeNull()
    expect(sessions[0]!.turnCount).toBe(2)
  })

  it('乱序输入按 turn 号排序后聚合（防御）', () => {
    // 排序后：turn3(3000–4000) → turn4(4010–4500) 间隔 10ms 合并；
    // turn5 起点 4500 + gap + 1 超过阈值 → 独立时段
    const gap = SESSION_GAP_MS
    const records = [workTurn(5, 4500 + gap + 1, 6000 + gap), workTurn(3, 3000, 4000, 1), workTurn(4, 4010, 4500, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(2)
    expectSession(sessions[0]!, 3, 2, 2, 0, 4500)
    expectSession(sessions[1]!, 5, 1, 0, 0, 6000 + gap)
  })

  it('idle turn 被跳过，不影响相邻有工作 turn 的聚合判定', () => {
    // turn 1 有工作（1000–2000），turn 2 idle（2500–2600），turn 3 有工作（3000–4000）
    // 聚合只看 hasWork 的相邻关系：turn1→turn3 间隔 1000ms <= 阈值 → 合并
    const records = [workTurn(1, 1000, 2000, 1), idleTurn(2, 2500, 2600), workTurn(3, 3000, 4000, 1)]
    const sessions = buildSessions(records)
    expect(sessions).toHaveLength(1)
    expectSession(sessions[0]!, 1, 2, 2, 0, 4000)
  })

  it('自定义 gapMs 生效（测试可注入）', () => {
    const records = [workTurn(1, 0, 1000), workTurn(2, 1500, 2000)]
    // 默认阈值 10 分钟 → 合并
    expect(buildSessions(records)).toHaveLength(1)
    // 阈值 100ms → 拆分
    expect(buildSessions(records, 100)).toHaveLength(2)
  })
})

describe('summarizeSessions — 摘要计数', () => {
  it('统计时段数 / 文件总数 / 仍变更数', () => {
    // 间隔超过阈值 → 2 个独立时段
    const gap = SESSION_GAP_MS
    const sessions = buildSessions([
      workTurn(1, 1000, 2000, 2, 1),
      workTurn(2, 2000 + gap + 1, 3000 + gap, 1, 0),
    ])
    const summary = summarizeSessions(sessions)
    expect(summary.sessions).toBe(2)
    expect(summary.files).toBe(4)
    // 全部 dirty → dirty = 4
    expect(summary.dirty).toBe(4)
  })

  it('空时段流 → 全零', () => {
    expect(summarizeSessions([])).toEqual({ sessions: 0, files: 0, dirty: 0 })
  })
})
