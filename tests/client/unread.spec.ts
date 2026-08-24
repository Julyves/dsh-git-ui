// @vitest-environment jsdom
/**
 * 工作记录增量未读(records/unread)单元测试。
 * countUnseen 纯函数 + localStorage 已读时刻读写容错。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { countUnseen, markSeen, readSeenAt } from '../../src/client/records/unread.ts'
import type { TurnWorkRecord } from '../../src/host/types.ts'

function turn(turnNo: number, entries: Array<{ path: string; firstSeenAt: number; group?: 'i' | 's' | 'e' }>): TurnWorkRecord {
  const pick = (group: 'i' | 's' | 'e') => entries.filter((e) => (e.group ?? 'i') === group)
    .map((e) => ({ path: e.path, status: 'modified' as const, state: 'dirty' as const, firstSeenAt: e.firstSeenAt }))
  return {
    turn: turnNo, startAt: 1000, endAt: 2000, hasWork: true, narrative: null,
    internal: pick('i'), sibling: pick('s'), external: pick('e'),
  }
}

describe('countUnseen', () => {
  it('counts entries first-seen after the seen mark across all groups', () => {
    const records = [turn(1, [
      { path: 'a.ts', firstSeenAt: 100 },
      { path: 'b.ts', firstSeenAt: 200, group: 's' },
      { path: 'c.ts', firstSeenAt: 300, group: 'e' },
    ])]
    expect(countUnseen(records, 150)).toBe(2)
    expect(countUnseen(records, 299)).toBe(1)
    expect(countUnseen(records, 300)).toBe(0)
  })

  it('never prunes by turn start (a long turn can straddle the mark)', () => {
    // turn 窗口早于已读时刻,但其条目 firstSeen 晚于已读时刻 → 仍计未读。
    const records = [turn(1, [{ path: 'late.ts', firstSeenAt: 5000 }])]
    expect(records[0]?.startAt).toBe(1000)
    expect(countUnseen(records, 2000)).toBe(1)
  })

  it('seenAt 0 (never viewed) or null records → 0 unread', () => {
    const records = [turn(1, [{ path: 'a.ts', firstSeenAt: 100 }])]
    expect(countUnseen(records, 0)).toBe(0)
    expect(countUnseen(null, 100)).toBe(0)
  })
})

describe('readSeenAt / markSeen (localStorage)', () => {
  afterEach(() => { window.localStorage.clear() })

  it('round-trips the seen timestamp per session', () => {
    expect(readSeenAt('s1')).toBe(0)
    const now = markSeen('s1', 12345)
    expect(now).toBe(12345)
    expect(readSeenAt('s1')).toBe(12345)
    expect(readSeenAt('s2')).toBe(0) // 会话隔离
  })

  it('degrades to 0 on corrupted values', () => {
    window.localStorage.setItem('dsh-git-ui:seen:s1', 'not-a-number')
    expect(readSeenAt('s1')).toBe(0)
  })
})
