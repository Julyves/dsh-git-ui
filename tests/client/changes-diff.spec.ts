import { describe, expect, it } from 'vitest'
import { diffBaseOf, reconcileDiffSelection } from '../../src/client/changes-diff.ts'

describe('diffBaseOf', () => {
  it('maps untracked and unstaged entries to the worktree base', () => {
    expect(diffBaseOf({ path: 'u.txt', status: 'untracked', staged: false })).toBe('worktree')
    expect(diffBaseOf({ path: 'm.txt', status: 'modified', staged: false })).toBe('worktree')
  })

  it('maps staged entries to the staged base', () => {
    expect(diffBaseOf({ path: 'm.txt', status: 'modified', staged: true })).toBe('staged')
    expect(diffBaseOf({ path: 'a.txt', status: 'added', staged: true })).toBe('staged')
  })
})

describe('reconcileDiffSelection', () => {
  const sel = { path: 'a.txt', base: 'worktree' as const }

  it('closes when the file disappears from the changes list', () => {
    expect(reconcileDiffSelection(sel, [])).toBeNull()
    expect(reconcileDiffSelection(sel, [{ path: 'b.txt', status: 'modified', staged: false }])).toBeNull()
  })

  it('keeps the base when the entry persists on the same side', () => {
    expect(reconcileDiffSelection(sel, [{ path: 'a.txt', status: 'modified', staged: false }]))
      .toEqual({ path: 'a.txt', base: 'worktree' })
  })

  it('rebases when the entry flips to the other side', () => {
    expect(reconcileDiffSelection(sel, [{ path: 'a.txt', status: 'modified', staged: true }]))
      .toEqual({ path: 'a.txt', base: 'staged' })
    expect(reconcileDiffSelection({ path: 'a.txt', base: 'staged' }, [{ path: 'a.txt', status: 'modified', staged: false }]))
      .toEqual({ path: 'a.txt', base: 'worktree' })
  })

  it('prefers the current base when both sides exist (MM dual entries)', () => {
    const changes = [
      { path: 'a.txt', status: 'modified', staged: true },
      { path: 'a.txt', status: 'modified', staged: false },
    ]
    expect(reconcileDiffSelection({ path: 'a.txt', base: 'staged' }, changes))
      .toEqual({ path: 'a.txt', base: 'staged' })
    expect(reconcileDiffSelection({ path: 'a.txt', base: 'worktree' }, changes))
      .toEqual({ path: 'a.txt', base: 'worktree' })
  })

  it('falls back to the surviving side when the current base has no entry', () => {
    const changes = [{ path: 'a.txt', status: 'modified', staged: true }]
    expect(reconcileDiffSelection({ path: 'a.txt', base: 'worktree' }, changes))
      .toEqual({ path: 'a.txt', base: 'staged' })
  })
})
