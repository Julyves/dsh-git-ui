import { describe, expect, it } from 'vitest'
import { latestWorkTurn, turnEntryCounts } from '../../src/client/work-record-meta.ts'
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