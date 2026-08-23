import { describe, expect, it } from 'vitest'
import { buildTimelineRows, latestWorkTurn, relativeTimeLabel, summarizeWork, turnEntryCounts } from '../../src/client/work-record-meta.ts'
import type { TurnWorkRecord } from '../../src/host/types.ts'

function turn(overrides: Partial<TurnWorkRecord>): TurnWorkRecord {
  return {
    turn: 1, startAt: 1000, endAt: 2000, hasWork: true, internal: [], external: [],
    ...overrides,
  }
}

describe('latestWorkTurn', () => {
  it('picks the newest turn that has tool activity', () => {
    const records = [
      turn({ turn: 1, hasWork: true }),
      turn({ turn: 2, hasWork: false }), // 空 turn(纯提问)
      turn({ turn: 3, hasWork: true }),
    ]
    expect(latestWorkTurn(records)?.turn).toBe(3)
  })

  it('falls back to the last working turn when the latest is empty', () => {
    const records = [turn({ turn: 1, hasWork: true }), turn({ turn: 2, hasWork: false })]
    expect(latestWorkTurn(records)?.turn).toBe(1)
  })

  it('returns undefined for null / empty / no-work lists', () => {
    expect(latestWorkTurn(null)).toBeUndefined()
    expect(latestWorkTurn([])).toBeUndefined()
    expect(latestWorkTurn([turn({ turn: 1, hasWork: false })])).toBeUndefined()
  })
})

describe('turnEntryCounts', () => {
  it('counts internal/external entries', () => {
    const records = [turn({ turn: 1, internal: [{ path: 'a', status: 'modified', state: 'dirty', firstSeenAt: 1 }] })]
    expect(turnEntryCounts(latestWorkTurn(records))).toEqual({ internal: 1, external: 0 })
  })

  it('returns zeros for an undefined window', () => {
    expect(turnEntryCounts(undefined)).toEqual({ internal: 0, external: 0 })
  })
})

/** 最小翻译桩:替换 {n} 后直接返回模板原文(断言 key 与替换逻辑)。 */
const t = (key: string): string => ({ 'time.justNow': '刚刚', 'time.minutesAgo': '{n} 分钟前', 'time.hoursAgo': '{n} 小时前', 'time.daysAgo': '{n} 天前' })[key] ?? key

describe('relativeTimeLabel', () => {
  const now = 1_000_000_000_000

  it('renders just-now for recent timestamps', () => {
    expect(relativeTimeLabel(now - 5_000, t, now)).toBe('刚刚')
  })

  it('renders minutes for sub-hour ages', () => {
    expect(relativeTimeLabel(now - 2 * 60_000, t, now)).toBe('2 分钟前')
  })

  it('renders hours for sub-day ages', () => {
    expect(relativeTimeLabel(now - 3 * 3_600_000, t, now)).toBe('3 小时前')
  })

  it('renders days beyond a day', () => {
    expect(relativeTimeLabel(now - 2 * 86_400_000, t, now)).toBe('2 天前')
  })

  it('clamps future timestamps to just-now', () => {
    expect(relativeTimeLabel(now + 60_000, t, now)).toBe('刚刚')
  })
})

describe('summarizeWork', () => {
  it('reflects only the latest working turn for internal/external/dirty', () => {
    const records = [
      turn({ turn: 1, internal: [{ path: 'old.ts', status: 'modified', state: 'dirty', firstSeenAt: 1 }] }),
      turn({ turn: 2, internal: [{ path: 'new.ts', status: 'modified', state: 'dirty', firstSeenAt: 2 }], external: [{ path: 'b.md', status: 'added', state: 'dirty', firstSeenAt: 3 }] }),
    ]
    // 最近工作 turn = turn 2:internal 1(仅 new.ts)、external 1、dirty 2;
    // 历史 turn 的 old.ts 不计入(窗口语义,与 pill 徽章同源)。
    expect(summarizeWork(records)).toEqual({ turns: 2, internal: 1, external: 1, dirty: 2 })
  })

  it('skips idle trailing turns when picking the latest working turn', () => {
    const records = [
      turn({ turn: 1, internal: [{ path: 'a.ts', status: 'added', state: 'dirty', firstSeenAt: 1 }] }),
      turn({ turn: 2, hasWork: false }),
    ]
    expect(summarizeWork(records)).toEqual({ turns: 1, internal: 1, external: 0, dirty: 1 })
  })

  it('counts only working turns', () => {
    const records = [turn({ turn: 1, hasWork: false }), turn({ turn: 2, hasWork: true })]
    expect(summarizeWork(records).turns).toBe(1)
  })

  it('returns zeros when no turn has work', () => {
    expect(summarizeWork([turn({ turn: 1, hasWork: false })])).toEqual({ turns: 0, internal: 0, external: 0, dirty: 0 })
  })
})

describe('buildTimelineRows', () => {
  it('keeps working turns and merges consecutive idle turns', () => {
    const records = [
      turn({ turn: 1, hasWork: true }),
      turn({ turn: 2, hasWork: false }),
      turn({ turn: 3, hasWork: false }),
      turn({ turn: 4, hasWork: true }),
    ]
    expect(buildTimelineRows(records)).toEqual([
      { kind: 'turn', turn: records[0] },
      { kind: 'idle', from: 2, to: 3 },
      { kind: 'turn', turn: records[3] },
    ])
  })

  it('keeps a single idle turn as its own idle row', () => {
    const records = [turn({ turn: 1, hasWork: false }), turn({ turn: 2, hasWork: true })]
    expect(buildTimelineRows(records)).toEqual([
      { kind: 'idle', from: 1, to: 1 },
      { kind: 'turn', turn: records[1] },
    ])
  })

  it('sorts by turn number defensively', () => {
    const records = [turn({ turn: 3, hasWork: true }), turn({ turn: 1, hasWork: true })]
    const rows = buildTimelineRows(records)
    expect(rows[0]?.kind).toBe('turn')
    expect(rows[0]?.kind === 'turn' && rows[0].turn.turn).toBe(1)
  })

  it('returns empty for an empty list', () => {
    expect(buildTimelineRows([])).toEqual([])
  })
})