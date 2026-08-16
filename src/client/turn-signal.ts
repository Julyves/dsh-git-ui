/**
 * Turn-completion signal for the git pill's activity trigger.
 *
 * The client runtime's ConversationSnapshot carries `turnEnds` — completed
 * turn numbers inside the snapshot window. A finished agent turn is the most
 * likely moment the working tree changed, so the pill watches the highest
 * completed turn and refreshes when it rises (best-effort; polling remains
 * the fallback). Kept React-free so the logic is unit-testable without a
 * browser runtime.
 */

/**
 * The slice of the conversation snapshot the pill observes for activity.
 * `turnEnds` maps completed turn numbers to their closing event seq inside
 * the snapshot window (source: the client runtime's ConversationSnapshot).
 */
export interface TurnSignalSnapshot {
  readonly turnEnds: ReadonlyMap<number, number>
}

/**
 * Highest completed turn number in the snapshot window, 0 when none.
 * Monotonic across ordinary activity (a finished turn only ever adds a
 * larger key), so `next > prev` is a reliable "an agent turn just ended"
 * edge — the best-effort trigger for an immediate refresh.
 */
export function completedTurnCount(snapshot: TurnSignalSnapshot): number {
  let max = 0
  for (const turn of snapshot.turnEnds.keys()) {
    if (turn > max) max = turn
  }
  return max
}
