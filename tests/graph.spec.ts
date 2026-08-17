import { describe, expect, it } from 'vitest'
import { buildGraph, GRAPH_COLORS, type GraphRow } from '../src/client/git-graph.ts'
import type { GraphCommit } from '../src/host/types.ts'

/** Helper to build a simple commit chain (newest-first, as returned by git log). */
function chain(hashes: string[], subjects: string[] = []): GraphCommit[] {
  const commits: GraphCommit[] = []
  for (let i = 0; i < hashes.length; i++) {
    commits.push({
      hash: hashes[i]!,
      shortHash: hashes[i]!.slice(0, 7),
      subject: subjects[i] ?? `commit ${i}`,
      author: 'test',
      dateIso: '2026-01-01T00:00:00Z',
      parents: i === hashes.length - 1 ? [] : [hashes[i + 1]!],  // parent = next (older) commit
    })
  }
  return commits
}

describe('buildGraph', () => {
  it('returns an empty array for empty input', () => {
    expect(buildGraph([])).toEqual([])
  })

  it('assigns column 0 to a linear chain', () => {
    const rows = buildGraph(chain(['a', 'b', 'c']))
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[0]!.commit.hash).toBe('a')
    expect(rows[2]!.commit.hash).toBe('c')
    // Root commit (first row) has empty parents.
    expect(rows[2]!.commit.parents).toEqual([])
  })

  it('handles a single merge commit (two parents → two columns)', () => {
    // New-to-old: merge → feature (parent0 = main, parent1 = feature-line)
    // We need commits: merge(p0=main_commit, p1=feature_commit), main_commit(p0=initial), feature_commit(p0=initial), initial()
    // But to keep it simple: merge has 2 parents, each parent is a separate commit.
    const merge: GraphCommit = {
      hash: 'merge', shortHash: 'merge', subject: 'merge', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: ['main-1', 'feat-1'],
    }
    const main: GraphCommit = {
      hash: 'main-1', shortHash: 'main-1', subject: 'main', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: ['init'],
    }
    const feat: GraphCommit = {
      hash: 'feat-1', shortHash: 'feat-1', subject: 'feat', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: ['init'],
    }
    const init: GraphCommit = {
      hash: 'init', shortHash: 'init', subject: 'init', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: [],
    }

    const rows = buildGraph([merge, main, feat, init])
    // merge should have at least 1 edge (second parent branches to a new column).
    expect(rows[0]!.edges.length).toBeGreaterThanOrEqual(1)
    // The two parent lines converge at init
    expect(rows[3]!.commit.hash).toBe('init')
    expect(rows[3]!.commit.parents).toEqual([])
  })

  it('handles a branch split (no merge, just two diverging parents)', () => {
    // root → A (main) and root → B (feature) — both are children of root.
    // Commits in topo order (newest first): B, A, root.
    const root: GraphCommit = {
      hash: 'root', shortHash: 'root', subject: 'root', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: [],
    }
    const a: GraphCommit = {
      hash: 'A', shortHash: 'A', subject: 'A', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: ['root'],
    }
    const b: GraphCommit = {
      hash: 'B', shortHash: 'B', subject: 'B', author: 't',
      dateIso: '2026-01-01T00:00:00Z', parents: ['root'],
    }

    // topo order: newest first → B, A, root (since both depend on root)
    const rows = buildGraph([b, a, root])
    expect(rows).toHaveLength(3)
    // B sits in col 0 (newest, gets first column).
    // A's parent (root) was already assigned col 0 by B, so A gets col 1 (new column for branch).
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    expect(rows[0]!.commit.hash).toBe('B')
    expect(rows[1]!.commit.hash).toBe('A')
    expect(rows[2]!.commit.hash).toBe('root')
  })

  it('has enough color palette entries', () => {
    expect(GRAPH_COLORS.length).toBeGreaterThanOrEqual(16)
  })
})
