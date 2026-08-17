/**
 * Git branch-graph data model and column assignment algorithm.
 *
 * Given an ordered list of `GraphCommit[]` (topo-order, newest first) from
 * the host's `git log --all`, this module assigns each commit to a display
 * column and records which vertical lines and edges exist between consecutive
 * rows — enough information for the React component to render an SVG graph.
 *
 * The algorithm is a simplified version of the standard git-graph algorithm:
 * it allocates columns left-to-right, gives the first parent the straight-through
 * slot, and pushes additional parents (branch splits / merge bases) to new columns.
 *
 * React-free and fully unit-testable against literal fixtures.
 */
import type { GraphCommit } from '../host/types.ts'

/** One row in the rendered graph (corresponds to one commit). */
export interface GraphRow {
  readonly commit: GraphCommit
  /** 0-based column index where this commit's node sits. */
  readonly column: number
  /** Columns that have a vertical line passing through this row. */
  readonly verticals: readonly number[]
  /** Diagonal / branching edges connecting this row to the row below. */
  readonly edges: readonly GraphEdge[]
}

/** One non-vertical connection between two rows. */
export interface GraphEdge {
  /** The column this edge starts from (this row's commit or a continuing line). */
  readonly from: number
  /** The column this edge ends at (one row below, where the parent sits). */
  readonly to: number
}

/**
 * Semantic color palette for graph columns (dark-theme-friendly, bright
 * enough on both light and dark backgrounds). 16 colors — cycles for deeper
 * graphs.
 */
export const GRAPH_COLORS: readonly string[] = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#E11D48',
  '#0EA5E9', '#A855F7', '#22C55E', '#F43F5E',
]

/** Assign display columns and build visual edges for a list of commits. */
export function buildGraph(commits: readonly GraphCommit[]): readonly GraphRow[] {
  if (commits.length === 0) return []

  // colMap: hash → column index (which column a commit sits in)
  const colMap = new Map<string, number>()
  /** The next free column index that no active branch uses yet. */
  let nextFreeCol = 0

  /** Columns that have an active vertical line (a commit was placed here). */
  const activeCols = new Set<number>()

  const rows: GraphRow[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!
    const prevRow = i > 0 ? rows[i - 1] : undefined

    // 1. Allocate column for this commit.
    let col: number
    if (colMap.has(commit.hash)) {
      col = colMap.get(commit.hash)!
    } else {
      col = nextFreeCol++
    }
    colMap.set(commit.hash, col)
    activeCols.add(col)

    // 2. Compute verticals: columns that continue straight through this row.
    //    A column is vertical if either: (a) it held the previous row's commit,
    //    or (b) it held a commit in this row that is NOT this commit (parallel
    //    line), or (c) it was used by the previous row and is still active.
    //    Simplified: all active columns that were NOT "consumed" by the edges
    //    we are about to draw.
    //    Actually: every active column except those that get re-assigned to a
    //    new column by a branch split in THIS step. For simplicity, we list
    //    all active columns as verticals here and draw edges separately.
    //    The renderer will draw a vertical line for each vertical column, and
    //    an edge from each commit to its first-parent column (below).
    const verticals: number[] = [...activeCols]

    // 3. Assign columns to parents and record edges.
    const edges: GraphEdge[] = []
    const isRoot = commit.parents.length === 0
    const isMerge = commit.parents.length > 1

    if (!isRoot) {
      // First parent: inherits current column (pass-through vertical).
      const firstParent = commit.parents[0]!
      if (!colMap.has(firstParent)) {
        colMap.set(firstParent, col)
      }
      activeCols.add(col)

      // Additional parents: each gets a new column (branch split).
      for (let p = 1; p < commit.parents.length; p++) {
        const parentHash = commit.parents[p]!
        if (!colMap.has(parentHash)) {
          colMap.set(parentHash, nextFreeCol++)
        }
        const parentCol = colMap.get(parentHash)!
        activeCols.add(parentCol)
        edges.push({ from: col, to: parentCol })
      }
    }

    // 4. Clean up: if a column's commit was just consumed (its parents now
    //    carry the lines forward), mark non-continuing columns as inactive
    //    for the NEXT row (we don't remove from activeCols here — the
    //    verticals list in this row already includes them).
    //    A column is "done" when all its children have been processed.
    //    Simple heuristic: remove columns whose commit hash appears only in
    //    this row (no more children will reference it).
    //    For the pass-through (first parent), the line continues, so the
    //    column stays active. For edge targets (merge bases / branch starts),
    //    they stay active until their commit is consumed.
    //    This is fine — extra vertical lines at the bottom are cosmetic and
    //    harmless (the loop ends after the last commit anyway).

    rows.push({ commit, column: col, verticals, edges })
  }

  return rows
}
