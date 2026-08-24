import { afterEach, describe, expect, it } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner } from '../src/host/git.ts'
import { runQuery } from '../src/host/queries.ts'
import { normalizeConfig, type SnapshotDeps } from '../src/host/core.ts'
import type { GitQueryRequest } from '../src/host/types.ts'
import { addBareRemote, git, gitInit, makeTempDir, realSubprocess } from './helpers.ts'

const temps: string[] = []
async function tempDir(): Promise<string> {
  const dir = await makeTempDir()
  temps.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CONFIG = normalizeConfig(undefined)

function depsFor(cwd: string): SnapshotDeps {
  return {
    run: createGitRunner(realSubprocess(), CONFIG.timeoutMs, CONFIG.maxStatusBytes),
    fs: { realpath, stat },
    sessions: {
      liveCwd: () => cwd,
      persistedMeta: async () => ({ cwd }),
    },
  }
}

const request = (sessionId: string, query: GitQueryRequest['query']): GitQueryRequest => ({ sessionId, query })

/** Three commits with known subjects; returns the dir. */
async function repoWithCommits(): Promise<string> {
  const dir = await tempDir()
  await gitInit(dir)
  await writeFile(join(dir, 'a.txt'), 'one\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'first commit')
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'second commit')
  await writeFile(join(dir, 'b.txt'), 'three\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'third commit')
  return dir
}

/** A repo with a merge commit (branch + merge), suitable for graph verification. */
async function repoWithMerge(): Promise<string> {
  const dir = await tempDir()
  await gitInit(dir)
  git(dir, 'checkout', '-b', 'feature')
  await writeFile(join(dir, 'f.txt'), 'feat\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'feature commit')
  git(dir, 'checkout', '-q', 'main')
  // Advance main so the merge is not fast-forward → creates a real merge commit.
  await writeFile(join(dir, 'm.txt'), 'main advance\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'main advance')
  git(dir, 'merge', '-m', 'merge feature', 'feature')
  return dir
}

describe('runQuery — history', () => {
  it('paginates newest-first with skip/limit and reports the total', async () => {
    const dir = await repoWithCommits() // initial + 3 named commits = 4 total
    const first = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 2, skip: 0 }))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.kind).toBe('history')
    if (first.value.kind !== 'history') return
    expect(first.value.commits.map((c) => c.subject)).toEqual(['third commit', 'second commit'])
    expect(first.value.total).toBe(4)

    const second = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 2, skip: 2 }))
    expect(second.ok).toBe(true)
    if (!second.ok || second.value.kind !== 'history') return
    expect(second.value.commits.map((c) => c.subject)).toEqual(['first commit', 'initial commit'])
  })

  it('clamps an oversized limit', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 9999, skip: 0 }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits).toHaveLength(4)
  })

  it('returns an empty history for an unborn repository', async () => {
    const dir = await tempDir()
    await gitInit(dir, { commit: false })
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 50, skip: 0 }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits).toEqual([])
    expect(result.value.total).toBe(0)
  })

  it('every commit has a parents array (root parents is empty)', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0 }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    const commits = result.value.commits
    // All non-root commits should have 1+ parents; root has empty parents.
    expect(commits[0]?.parents).toHaveLength(1) // third → second
    expect(commits[commits.length - 1]?.parents).toEqual([]) // initial = root
  })

  it('returns merge commits with 2+ parents (graph data)', async () => {
    const dir = await repoWithMerge()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0 }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    // The merge commit should have 2 parents.
    const merge = result.value.commits.find((c) => c.subject === 'merge feature')
    expect(merge).toBeDefined()
    expect(merge!.parents.length).toBe(2)
  })

  it('attaches refs decorations: head branch, feature branch, remote and tag', async () => {
    const dir = await repoWithMerge()
    git(dir, 'tag', 'v1.0') // 打在 HEAD（merge 提交）上
    await addBareRemote(dir) // push main 到 origin
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0 }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    const commits = result.value.commits
    const merged = commits.find((c) => c.subject === 'merge feature')!
    // HEAD 当前分支 + 远程跟踪 + 标签均挂在 merge 提交上。
    expect(merged.refs).toContainEqual({ kind: 'branch', name: 'main', head: true })
    expect(merged.refs).toContainEqual({ kind: 'remote', name: 'origin/main', head: false })
    expect(merged.refs).toContainEqual({ kind: 'tag', name: 'v1.0', head: false })
    const feature = commits.find((c) => c.subject === 'feature commit')!
    expect(feature.refs).toContainEqual({ kind: 'branch', name: 'feature', head: false })
    // 无装饰的提交 refs 为空。
    const advance = commits.find((c) => c.subject === 'main advance')!
    expect(advance.refs).toEqual([])
  })

  it('filters history to the given ref scope with its own total', async () => {
    const dir = await repoWithMerge()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, ref: 'feature' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    // feature 分支仅含 feature commit 与 initial。
    expect(result.value.commits.map((c) => c.subject)).toEqual(['feature commit', 'initial commit'])
    expect(result.value.total).toBe(2)
  })

  it('rejects an invalid history ref', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, ref: 'bad ref' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-name')
  })

  it('searches commit messages case-insensitively', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: 'THIRD' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits.map((c) => c.subject)).toEqual(['third commit'])
    expect(result.value.total).toBe(1)
  })

  it('jumps to a hash prefix and yields empty for unknown prefixes', async () => {
    const dir = await repoWithCommits()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const hit = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: head.slice(0, 7) }))
    expect(hit.ok).toBe(true)
    if (!hit.ok || hit.value.kind !== 'history') return
    expect(hit.value.commits[0]?.hash).toBe(head)
    const miss = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: 'deadbeefdeadbeef' }))
    expect(miss.ok).toBe(true)
    if (!miss.ok || miss.value.kind !== 'history') return
    expect(miss.value.commits).toEqual([])
  })

  it('filters by author and since', async () => {
    const dir = await repoWithCommits()
    const byAuthor = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, author: 'Test User' }))
    expect(byAuthor.ok).toBe(true)
    if (!byAuthor.ok || byAuthor.value.kind !== 'history') return
    expect(byAuthor.value.total).toBe(4)
    const none = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, author: 'Nobody' }))
    expect(none.ok).toBe(true)
    if (!none.ok || none.value.kind !== 'history') return
    expect(none.value.total).toBe(0)
    // 未来日期下限：全部排除。
    const future = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, since: '2099-01-01' }))
    expect(future.ok).toBe(true)
    if (!future.ok || future.value.kind !== 'history') return
    expect(future.value.total).toBe(0)
  })
})

describe('runQuery — diff', () => {
  it('returns the worktree diff for a modified file', async () => {
    const dir = await repoWithCommits()
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'diff', path: 'a.txt', base: 'worktree' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'diff') return
    expect(result.value.text).toContain('+three')
  })

  it('returns the staged diff with --cached semantics', async () => {
    const dir = await repoWithCommits()
    await writeFile(join(dir, 'a.txt'), 'one\nchanged\n')
    git(dir, 'add', 'a.txt')
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'diff', path: 'a.txt', base: 'staged' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'diff') return
    expect(result.value.text).toContain('+changed')
    expect(result.value.text).toContain('-two')
  })

  it('returns an all-add diff for unversioned files via --no-index', async () => {
    const dir = await repoWithCommits()
    await writeFile(join(dir, 'untracked.txt'), 'hello\n')
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'diff', path: 'untracked.txt', base: 'worktree' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'diff') return
    expect(result.value.text).toContain('+hello')
  })

  it('rejects an unsafe path', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'diff', path: '../etc/passwd', base: 'worktree' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-path')
  })
})

describe('runQuery — show', () => {
  it('returns commit metadata and file stats for show', async () => {
    const dir = await repoWithCommits()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: head }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'show') return
    expect(result.value.commit?.subject).toBe('third commit')
    expect(result.value.stats).toEqual([{ path: 'b.txt', status: 'added' }])
  })

  it('returns raw UTF-8 paths for non-ASCII file names (no C-style quoting)', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, '产品文档.md'), '内容\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'add chinese doc')
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: head }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'show') return
    // 旧 --stat 会输出 \346\226\207 八进制转义；name-status -z 必须原样返回。
    expect(result.value.stats).toEqual([{ path: '产品文档.md', status: 'added' }])
  })

  it('returns the full commit body for multi-line messages', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, 'commit', '--allow-empty', '-m', 'subject line', '-m', 'body one', '-m', 'body two')
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: head }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'show') return
    expect(result.value.commit?.subject).toBe('subject line')
    expect(result.value.body).toContain('body one')
    expect(result.value.body).toContain('body two')
    // subject 行不混入正文。
    expect(result.value.body.startsWith('subject line')).toBe(false)
  })

  it('rejects an invalid ref', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: 'has space' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-name')
  })
})

describe('runQuery — branches', () => {
  it('lists local and remote branches with the current marker', async () => {
    const dir = await repoWithCommits()
    await addBareRemote(dir)
    git(dir, 'checkout', '-b', 'feature/x')
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'branches' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'branches') return
    expect(result.value.current).toBe('feature/x')
    expect(result.value.local.map((b) => b.name).sort()).toEqual(['feature/x', 'main'])
    expect(result.value.remote.some((b) => b.name === 'origin/main')).toBe(true)
    // The symbolic origin/HEAD row is filtered out.
    expect(result.value.remote.some((b) => b.name === 'origin/HEAD')).toBe(false)
  })

  it('reports the default branch from origin/HEAD when available', async () => {
    const dir = await repoWithCommits()
    await addBareRemote(dir)
    // 未设置符号引用时为 null。
    const before = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'branches' }))
    expect(before.ok).toBe(true)
    if (!before.ok || before.value.kind !== 'branches') return
    expect(before.value.defaultBranch).toBeNull()
    git(dir, 'remote', 'set-head', 'origin', 'main')
    const after = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'branches' }))
    expect(after.ok).toBe(true)
    if (!after.ok || after.value.kind !== 'branches') return
    expect(after.value.defaultBranch).toBe('main')
  })
})

describe('runQuery — authors', () => {
  it('lists unique sorted author names', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'authors' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'authors') return
    expect(result.value.authors).toEqual(['Test User'])
  })
})

describe('runQuery — tags', () => {
  it('lists tags with their short hashes', async () => {
    const dir = await repoWithMerge()
    git(dir, 'tag', 'v1.0')
    git(dir, 'tag', 'rc-1')
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'tags' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'tags') return
    expect(result.value.tags.map((t) => t.name).sort()).toEqual(['rc-1', 'v1.0'])
    expect(result.value.tags.every((t) => t.shortHash !== null)).toBe(true)
  })

  it('returns an empty list when no tags exist', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'tags' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'tags') return
    expect(result.value.tags).toEqual([])
  })
})


describe('runQuery — 注入面加固(H5:ref 选项注入拒绝)', () => {
  it('rejects history refs that start with "-" (would be read as git options)', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s', { kind: 'history', limit: 10, skip: 0, ref: '--grep=x' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-name')
  })

  it('rejects show refs that start with "-" (arg-injection surface)', async () => {
    const dir = await repoWithCommits()
    const result = await runQuery(depsFor(dir), CONFIG, request('s', { kind: 'show', ref: '--output=/tmp/x' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-name')
  })
})
