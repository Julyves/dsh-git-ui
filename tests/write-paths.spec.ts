import { describe, expect, it } from 'vitest'
import {
  bashWriteTargets, extractWritePaths, isWriteKind, metaWritePaths,
  normalizeRepoPath, tokenizeShell, type ToolPresenter, type ToolViewSlice,
} from '../src/host/write-paths.ts'

/** 构造一个返回固定视图的 presenter。 */
function presenterOf(view: ToolViewSlice): ToolPresenter {
  return { presentCall: () => view }
}

describe('isWriteKind', () => {
  it('accepts write kinds and rejects read kinds', () => {
    expect(isWriteKind('edit')).toBe(true)
    expect(isWriteKind('delete')).toBe(true)
    expect(isWriteKind('move')).toBe(true)
    expect(isWriteKind('read')).toBe(false)
    expect(isWriteKind('search')).toBe(false)
    expect(isWriteKind('execute')).toBe(false)
    expect(isWriteKind(undefined)).toBe(false)
  })
})

describe('extractWritePaths — diff card', () => {
  const presenter = presenterOf({
    card: 'diff',
    locations: [{ path: 'a.ts' }, { path: '/abs/repo/b.ts' }],
    diffs: [{ path: 'a.ts' }, { path: 'c.ts' }],
  })

  it('collects locations + diffs paths, normalized and deduped', () => {
    expect(extractWritePaths('write', '{}', '/abs/repo', presenter)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('drops paths outside the repo root', () => {
    const presenter = presenterOf({ card: 'diff', diffs: [{ path: '/elsewhere/x.ts' }] })
    expect(extractWritePaths('write', '{}', '/abs/repo', presenter)).toEqual([])
  })

  it('handles Windows drive paths', () => {
    const presenter = presenterOf({ card: 'diff', diffs: [{ path: 'C:\\abs\\repo\\w.ts' }] })
    expect(extractWritePaths('write', '{}', 'C:/abs/repo', presenter)).toEqual(['w.ts'])
  })
})

describe('extractWritePaths — generic write kind', () => {
  it('takes locations when kind is a write kind', () => {
    const presenter = presenterOf({ card: 'generic', kind: 'delete', locations: [{ path: 'old.ts' }] })
    expect(extractWritePaths('delete', '{}', '/repo', presenter)).toEqual(['old.ts'])
  })

  it('ignores generic read/execute cards', () => {
    const presenter = presenterOf({ card: 'generic', kind: 'read', locations: [{ path: 'read-me.ts' }] })
    expect(extractWritePaths('read', '{}', '/repo', presenter)).toEqual([])
  })
})

describe('extractWritePaths — args fallback catalog', () => {
  it('extracts file_path from known write tools when presenter yields nothing', () => {
    expect(extractWritePaths('write', '{"file_path":"docs/test.txt","content":"hi"}', '/repo', undefined))
      .toEqual(['docs/test.txt'])
  })

  it('does not guess for unknown tools (read tools excluded)', () => {
    expect(extractWritePaths('read', '{"file_path":"docs/test.txt"}', '/repo', undefined)).toEqual([])
  })

  it('skips the fallback when an earlier source produced paths', () => {
    const presenter = presenterOf({ card: 'diff', diffs: [{ path: 'a.ts' }] })
    expect(extractWritePaths('write', '{"file_path":"docs/test.txt"}', '/repo', presenter)).toEqual(['a.ts'])
  })

  it('tolerates malformed args JSON', () => {
    expect(extractWritePaths('write', '{not json', '/repo', undefined)).toEqual([])
  })
})

describe('extractWritePaths — shell/terminal heuristic', () => {
  it('parses the terminal card title', () => {
    const presenter = presenterOf({ card: 'terminal', title: 'echo x > out.txt', cwd: '/repo/sub' })
    expect(extractWritePaths('bash', '{"command":"ignored"}', '/repo', presenter)).toEqual(['sub/out.txt'])
  })

  it('parses bash args.command directly when the tool is a shell without presenter', () => {
    expect(extractWritePaths('bash', '{"command":"cp a.txt b.txt"}', '/repo', undefined))
      .toEqual(['b.txt'])
  })
})

describe('tokenizeShell', () => {
  it('respects quotes, escapes and separators; quotes stay in tokens', () => {
    expect(tokenizeShell('echo "a b" \\"c\\" > f; g')).toEqual(['echo', '"a b"', '"c"', '>', 'f', ';', 'g'])
  })
})

describe('bashWriteTargets — static write patterns', () => {
  const repo = '/repo'

  it('captures output redirection', () => {
    expect(bashWriteTargets('echo hi > out.txt', undefined, repo)).toEqual(['out.txt'])
    expect(bashWriteTargets('cmd >> log/app.log', '/repo', repo)).toEqual(['log/app.log'])
    expect(bashWriteTargets('cmd 2> err.log 1> out.log', undefined, repo)).toEqual(['err.log', 'out.log'])
    expect(bashWriteTargets('echo hi >out.txt', undefined, repo)).toEqual(['out.txt'])
  })

  it('captures tee targets', () => {
    expect(bashWriteTargets('echo x | tee a.txt b.txt', undefined, repo)).toEqual(['a.txt', 'b.txt'])
    expect(bashWriteTargets('echo x | tee -a log.txt > /dev/null', undefined, repo)).toEqual(['log.txt'])
  })

  it('captures sed -i targets (last non-option arg)', () => {
    expect(bashWriteTargets("sed -i 's/a/b/' f.txt", undefined, repo)).toEqual(['f.txt'])
  })

  it('captures cp/mv/install destinations', () => {
    expect(bashWriteTargets('cp src.ts dist.ts', undefined, repo)).toEqual(['dist.ts'])
    expect(bashWriteTargets('mv old.ts new.ts', undefined, repo)).toEqual(['new.ts'])
    expect(bashWriteTargets('install -m 644 a b c', undefined, repo)).toEqual(['c'])
  })

  it('captures dd of=', () => {
    expect(bashWriteTargets('dd if=i.bin of=/repo/out.bin', undefined, repo)).toEqual(['out.bin'])
  })

  it('resolves relative targets against the bash cwd', () => {
    expect(bashWriteTargets('echo x > out.txt', '/repo/src', repo)).toEqual(['src/out.txt'])
  })

  it('does not false-positive on command substitution / glob (documented misses)', () => {
    expect(bashWriteTargets('echo x > $(name).txt', undefined, repo)).toEqual([])
    expect(bashWriteTargets('tee *.log', undefined, repo)).toEqual([])
    expect(bashWriteTargets('sed -i "s/a/b/" $(find . -name "*.ts")', undefined, repo)).toEqual([])
    expect(bashWriteTargets('eval "echo x > f.txt"', undefined, repo)).toEqual([])
  })

  it('does not treat redirect targets inside quotes as writes', () => {
    expect(bashWriteTargets("echo 'a > b'", undefined, repo)).toEqual([])
  })
})

describe('normalizeRepoPath', () => {
  it('passes relative paths through with slash separators', () => {
    expect(normalizeRepoPath('src/a.ts', '/repo')).toBe('src/a.ts')
    expect(normalizeRepoPath('dir\\file.ts', '/repo')).toBe('dir/file.ts')
  })

  it('relativizes absolute paths inside the repo', () => {
    expect(normalizeRepoPath('/repo/a/b.ts', '/repo')).toBe('a/b.ts')
  })

  it('rejects paths outside the repo', () => {
    expect(normalizeRepoPath('/other/x.ts', '/repo')).toBeNull()
    expect(normalizeRepoPath('../x.ts', '/repo')).toBeNull()
  })

  it('collapses dot segments', () => {
    expect(normalizeRepoPath('a/./b/../c.ts', '/repo')).toBe('a/c.ts')
  })

  it('rejects empty and whitespace paths', () => {
    expect(normalizeRepoPath('', '/repo')).toBeNull()
    expect(normalizeRepoPath('   ', '/repo')).toBeNull()
  })
})

describe('metaWritePaths', () => {
  it('extracts diffs[].path from the FsDiffMeta shape', () => {
    expect(metaWritePaths({ diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] }, '/repo')).toEqual(['a.ts'])
  })

  it('normalizes absolute paths to repo-relative (no duplicate entries)', () => {
    // 回归:dsh write/edit 把模型入参 args.file_path 投影为 diff paths,
    // 模型常传绝对路径——不归一化会导致同文件绝对/相对双记录(已提交+仍变更)。
    expect(metaWritePaths(
      { diffs: [{ path: '/repo/src/a.ts', oldText: null, newText: 'x' }] },
      '/repo',
    )).toEqual(['src/a.ts'])
  })

  it('drops paths outside the repository (git-based constraint)', () => {
    expect(metaWritePaths({ diffs: [{ path: '/elsewhere/a.ts', oldText: null, newText: 'x' }] }, '/repo')).toEqual([])
  })

  it('handles non-object, empty and malformed meta', () => {
    expect(metaWritePaths(undefined, '/repo')).toEqual([])
    expect(metaWritePaths(null, '/repo')).toEqual([])
    expect(metaWritePaths('x', '/repo')).toEqual([])
    expect(metaWritePaths({ diffs: 'nope' }, '/repo')).toEqual([])
    expect(metaWritePaths({ diffs: [{ nope: 1 }] }, '/repo')).toEqual([])
  })
})