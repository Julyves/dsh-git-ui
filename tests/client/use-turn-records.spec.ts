import { describe, expect, it } from 'vitest'
import { latestWorkTurn, relativeTimeLabel, turnEntryCounts } from '../../src/client/work-record-meta.ts'
import type { TurnWorkRecord } from '../../src/host/types.ts'

function turn(overrides: Partial<TurnWorkRecord>): TurnWorkRecord {
  return {
    turn: 1, startAt: 1000, endAt: 2000, hasWork: true, narrative: null, internal: [], sibling: [], external: [],
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
  it('counts internal/sibling/external entries (three-way authorship)', () => {
    const records = [turn({
      turn: 1,
      internal: [{ path: 'a', status: 'modified', state: 'dirty', firstSeenAt: 1, commitHash: null, attribution: 'authoritative' }],
      sibling: [{ path: 'c', status: 'modified', state: 'dirty', firstSeenAt: 1, commitHash: null, attribution: 'authoritative' }],
    })]
    expect(turnEntryCounts(latestWorkTurn(records))).toEqual({ internal: 1, sibling: 1, external: 0 })
  })

  it('returns zeros for an undefined window', () => {
    expect(turnEntryCounts(undefined)).toEqual({ internal: 0, sibling: 0, external: 0 })
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
