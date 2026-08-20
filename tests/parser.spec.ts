import { describe, expect, it } from 'vitest'
import { parseBranchOutput, parseDecorations, parseGraphLogOutput, parseLogOutput, parseNameStatusOutput, parseShowMeta, parseStatusHeader, parseStatusOutput } from '../src/host/parser.ts'

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
      { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
      { path: 'u.txt', status: 'untracked', staged: false, isDirectory: false },
    ])
  })

  it('marks untracked directory entries as directories (regression: .agent/)', () => {
    // git status 对未跟踪目录输出 `dir/`（尾斜杠）：host 必须保留并权威标记
    // isDirectory=true，展示层据此显示文件夹，不再依赖字符串派生。
    const parsed = parseStatusOutput('## main\u0000?? .agent/\u0000?? sub/dir/\u0000?? u.txt\u0000', 100)
    expect(parsed.changes).toEqual([
      { path: '.agent/', status: 'untracked', staged: false, isDirectory: true },
      { path: 'sub/dir/', status: 'untracked', staged: false, isDirectory: true },
      { path: 'u.txt', status: 'untracked', staged: false, isDirectory: false },
    ])
  })

  it('parses staged entries', () => {
    const parsed = parseStatusOutput('## main\u0000M  a.txt\u0000A  new.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 2, modified: 0 })
    expect(parsed.changes).toEqual([
      { path: 'a.txt', status: 'modified', staged: true, isDirectory: false },
      { path: 'new.txt', status: 'added', staged: true, isDirectory: false },
    ])
  })

  it('consumes the rename source path as part of the rename entry', () => {
    const parsed = parseStatusOutput('## main\u0000R  new.txt\u0000old.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 1, modified: 0 })
    expect(parsed.changes).toEqual([{ path: 'new.txt', status: 'renamed', staged: true, isDirectory: false }])
  })

  it('classifies conflicted entries', () => {
    const parsed = parseStatusOutput('## main\u0000UU c.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 1, modified: 1 })
    expect(parsed.changes).toEqual([{ path: 'c.txt', status: 'conflicted', staged: true, isDirectory: false }])
  })

  it('keeps genuine conflict pairs (AA/DD) as single conflicted entries', () => {
    const parsed = parseStatusOutput('## main\u0000AA c.txt\u0000DD d.txt\u0000', 100)
    expect(parsed.changes).toEqual([
      { path: 'c.txt', status: 'conflicted', staged: true, isDirectory: false },
      { path: 'd.txt', status: 'conflicted', staged: true, isDirectory: false },
    ])
  })

  it('splits mixed XY states into staged and unstaged entries (IDEA-style)', () => {
    const parsed = parseStatusOutput('## main\u0000MM a.txt\u0000AM b.txt\u0000', 100)
    expect(parsed).toMatchObject({ staged: 2, modified: 2 })
    expect(parsed.changes).toEqual([
      { path: 'a.txt', status: 'modified', staged: true, isDirectory: false },
      { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
      { path: 'b.txt', status: 'added', staged: true, isDirectory: false },
      { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    ])
  })

  it('reads the status of an unstaged-only entry from the Y column', () => {
    const parsed = parseStatusOutput('## main\u0000 D gone.txt\u0000', 100)
    expect(parsed.changes).toEqual([{ path: 'gone.txt', status: 'deleted', staged: false, isDirectory: false }])
  })

  it('caps dual entries of one mixed file together', () => {
    const parsed = parseStatusOutput('## main\u0000MM a.txt\u0000 M b.txt\u0000', 2)
    expect(parsed).toMatchObject({ staged: 1, modified: 2, truncated: true })
    expect(parsed.changes).toEqual([
      { path: 'a.txt', status: 'modified', staged: true, isDirectory: false },
      { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    ])
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

describe('parseDecorations', () => {
  it('returns an empty list for empty decorations', () => {
    expect(parseDecorations('', ['origin'])).toEqual([])
    expect(parseDecorations(' ', ['origin'])).toEqual([])
  })

  it('classifies HEAD branch, local branch, remote and tag', () => {
    const refs = parseDecorations('HEAD -> main, feature/x, origin/main, tag: v1.0', ['origin'])
    expect(refs).toEqual([
      { kind: 'branch', name: 'main', head: true },
      { kind: 'branch', name: 'feature/x', head: false },
      { kind: 'remote', name: 'origin/main', head: false },
      { kind: 'tag', name: 'v1.0', head: false },
    ])
  })

  it('treats slash names without a known remote prefix as local branches', () => {
    const refs = parseDecorations('origin/dev, release/1.2', ['origin'])
    expect(refs).toEqual([
      { kind: 'remote', name: 'origin/dev', head: false },
      { kind: 'branch', name: 'release/1.2', head: false },
    ])
  })
})

describe('parseShowMeta', () => {
  it('parses metadata and passes the %b body through verbatim', () => {
    const out = 'h1\x1fs1\x1fsubject line\x1fAlice\x1f2026-01-01T00:00:00Z\x1fbody one\nbody two\n'
    const parsed = parseShowMeta(out)
    expect(parsed).not.toBeNull()
    expect(parsed!.commit).toMatchObject({ hash: 'h1', subject: 'subject line', author: 'Alice' })
    expect(parsed!.body).toBe('body one\nbody two')
  })

  it('keeps multi-paragraph bodies intact without subject duplication', () => {
    // %b 已排除首段落：多行首段落的续行不会再混入正文。
    const parsed = parseShowMeta('h3\x1fs3\x1flong subject\x1fBob\x1f2026-01-01T00:00:00Z\x1fpara two line\n')
    expect(parsed!.body).toBe('para two line')
  })

  it('yields an empty body when %b is empty', () => {
    const parsed = parseShowMeta('h2\x1fs2\x1fonly subject\x1fBob\x1f2026-01-01T00:00:00Z\x1f\n')
    expect(parsed!.body).toBe('')
  })

  it('returns null for empty output', () => {
    expect(parseShowMeta('')).toBeNull()
  })
})

describe('parseNameStatusOutput', () => {
  it('parses status codes and paths from NUL-separated output', () => {
    const out = 'M\0src/a.ts\0A\0new.txt\0D\0old.txt\0'
    expect(parseNameStatusOutput(out)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.txt', status: 'added' },
      { path: 'old.txt', status: 'deleted' },
    ])
  })

  it('takes the new path for renames and keeps raw UTF-8 names', () => {
    const out = 'R100\0旧目录/旧名.md\0新目录/新名.md\0'
    expect(parseNameStatusOutput(out)).toEqual([
      { path: '新目录/新名.md', status: 'renamed' },
    ])
  })

  it('returns an empty list for empty output', () => {
    expect(parseNameStatusOutput('')).toEqual([])
  })
})

describe('parseGraphLogOutput', () => {
  it('parses parents and refs from the extended format', () => {
    const line = 'h1\x1fs1\x1fsubject\x1fAlice\x1f2026-01-01T00:00:00Z\x1fp1 p2\x1fHEAD -> main, tag: v1\n'
    const commits = parseGraphLogOutput(line, [])
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      hash: 'h1',
      parents: ['p1', 'p2'],
      refs: [
        { kind: 'branch', name: 'main', head: true },
        { kind: 'tag', name: 'v1', head: false },
      ],
    })
  })

  it('yields empty parents and refs for a root commit without decorations', () => {
    const commits = parseGraphLogOutput('h2\x1fs2\x1froot\x1fBob\x1f2026-01-01T00:00:00Z\x1f\x1f\n', [])
    expect(commits[0]).toMatchObject({ parents: [], refs: [] })
  })
})
