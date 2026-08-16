import { describe, expect, it } from 'vitest'
import { completedTurnCount, type TurnSignalSnapshot } from '../../src/client/turn-signal.ts'

function signal(turns: readonly number[]): TurnSignalSnapshot {
  return { turnEnds: new Map(turns.map((turn, index) => [turn, index])) }
}

describe('completedTurnCount', () => {
  it('returns 0 for an empty window', () => {
    expect(completedTurnCount(signal([]))).toBe(0)
  })

  it('returns the single completed turn', () => {
    expect(completedTurnCount(signal([3]))).toBe(3)
  })

  it('returns the highest completed turn regardless of insertion order', () => {
    expect(completedTurnCount(signal([5, 9, 3, 7]))).toBe(9)
  })

  it('is monotonic as turns complete: a new turn only raises the count', () => {
    const before = completedTurnCount(signal([1, 2, 3]))
    const after = completedTurnCount(signal([1, 2, 3, 4]))
    expect(after).toBeGreaterThan(before)
  })

  it('does not drop when older turns leave the window (only the max matters)', () => {
    // Window slides: turn 4 completes while turn 1 is evicted.
    const before = completedTurnCount(signal([1, 2, 3]))
    const after = completedTurnCount(signal([2, 3, 4]))
    expect(after).toBeGreaterThan(before)
  })

  it('stays flat when the window loses a turn without a new completion', () => {
    // Eviction only: max key unchanged — no spurious trigger.
    const before = completedTurnCount(signal([1, 2, 3, 4]))
    const after = completedTurnCount(signal([2, 3, 4]))
    expect(after).toBe(before)
  })
})
