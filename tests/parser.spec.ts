import { describe, expect, it } from 'vitest'
import { parseBranchOutput, parseLogOutput, parseStatusHeader, parseStatusOutput } from '../src/host/parser.ts'

describe('parseStatusHeader', () => {
  it('parses a bare branch line', () => {
    expect(parseStatusHeader('## main')).toEqual({ branch: 'main', unborn: false, ahead: 0, behind: 0 })
  })

  it('parses branch...upstream without brackets', () => {
    expect(parseStatusHeader('## main...origin/main')).toEqual({ branch: 'main', unborn: false, ahead: 0, behind: 0 })
  })

  it('parses ahead only', () => {
    expect(parseStatusHeader('## main...origin/main [ahead 1]')).toEqual({
      branch: 'main', unborn: false, ahead: 1, behind: 0,
    })
  })

  it('parses behind only', () => {
    expect(parseStatusHeader('## main...origin/main [behind 2]')).toEqual({
      branch: 'main', unborn: false, ahead: 0, behind: 2,
    })
  })

  it('parses ahead and behind together', () => {
    expect(parseStatusHeader('## main...origin/main [ahead 1, behind 2]')).toEqual({
      branch: 'main', unborn: false, ahead: 1, behind: 2,
    })
  })

  it('parses detached HEAD forms', () => {
    expect(parseStatusHeader('## HEAD (no branch)').branch).toBeNull()
    expect(parseStatusHeader('## HEAD (detached at abc1234)').branch).toBeNull()
  })

  it('parses unborn forms', () => {
    expect(parseStatusHeader('## No commits yet on main')).toEqual({
      branch: 'main', unborn: true, ahead: 0, behind: 0,
    })
    expect(parseStatusHeader('## Initial commit on main').unborn).toBe(true)
  })
})

describe('parseStatusOutput', () => {
  it('parses a clean repository (header only)', () => {
    const parsed = parseStatusOutput('## main\u0000', 100)
    expect(parsed).toMatchObject({ branch: 'main', staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, truncated: false })
    expect(parsed.changes).toEqual([])
  })

  it('parses modified and untracked entries', () => {
    const parsed = parseStatusOutput('## main\u0000 M a.txt\u0000?? u.txt\u0000', 100)
    expect(parsed).toMatchObject({ modified: 1, untracked: 1, staged: 0 })
    expect(parsed.changes).toEqual([
      { path: 'a.txt', status: 'modified', staged: false },
      { path: 'u.txt', status: 'untracked', staged: false },
    ])
  })

  it('parses staged entries', () => {
    const parsed = parseStatusOutput('## main\u0000M  a.txt\u0000A  new.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 2, modified: 0 })
    expect(parsed.changes).toEqual([
      { path: 'a.txt', status: 'modified', staged: true },
      { path: 'new.txt', status: 'added', staged: true },
    ])
  })

  it('consumes the rename source path as part of the rename entry', () => {
    const parsed = parseStatusOutput('## main\u0000R  new.txt\u0000old.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 1, modified: 0 })
    expect(parsed.changes).toEqual([{ path: 'new.txt', status: 'renamed', staged: true }])
  })

  it('classifies conflicted entries', () => {
    const parsed = parseStatusOutput('## main\u0000UU c.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 1, modified: 1 })
    expect(parsed.changes).toEqual([{ path: 'c.txt', status: 'conflicted', staged: true }])
  })

  it('caps the change list but keeps full counts', () => {
    const parsed = parseStatusOutput('## main\u0000 M a\u0000 M b\u0000 M c\u0000', 2)
    expect(parsed).toMatchObject({ modified: 3, truncated: true })
    expect(parsed.changes).toHaveLength(2)
  })

  it('parses detached and unborn headers', () => {
    expect(parseStatusOutput('## HEAD (no branch)\u0000', 100).branch).toBeNull()
    expect(parseStatusOutput('## No commits yet on main\u0000', 100)).toMatchObject({
      branch: 'main', unborn: true,
    })
  })
})

describe('parseLogOutput', () => {
  it('parses one commit per line', () => {
    const out = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\u001fa1b2c3d\u001fsubject one\u001fAlice\u001f2026-08-16T10:00:00+08:00\n'
      + 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4\u001fb2c3d4e\u001fsubject two\u001fBob\u001f2026-08-15T09:30:00+08:00\n'
    expect(parseLogOutput(out)).toEqual([
      { hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', shortHash: 'a1b2c3d', subject: 'subject one', author: 'Alice', dateIso: '2026-08-16T10:00:00+08:00' },
      { hash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', shortHash: 'b2c3d4e', subject: 'subject two', author: 'Bob', dateIso: '2026-08-15T09:30:00+08:00' },
    ])
  })

  it('returns an empty list for empty output (unborn)', () => {
    expect(parseLogOutput('')).toEqual([])
  })
})

describe('parseBranchOutput', () => {
  it('returns the branch name', () => {
    expect(parseBranchOutput('main\n')).toBe('main')
  })

  it('returns null for empty output (detached)', () => {
    expect(parseBranchOutput('')).toBeNull()
    expect(parseBranchOutput('\n')).toBeNull()
  })
})
