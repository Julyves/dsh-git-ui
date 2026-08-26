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
    // `%(refname:short)` 把 origin/HEAD 折叠成裸 `origin`：远程列表不得混入该
    // 折叠物（否则左栏远程文件夹出现语义模糊的裸 origin「分支」）。
    expect(after.value.remote.some((b) => b.name === 'origin')).toBe(false)
    expect(after.value.remote.some((b) => b.name === 'origin/HEAD')).toBe(false)
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

describe('runQuery — bug-hunt 回归锁(B2/B3/B6, fix/bug-hunt)', () => {
  /** 带正则元字符主题的仓库：feat(graph) / plain / [wip] thing。 */
  async function repoWithRegexSubjects(): Promise<string> {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, 'commit', '--allow-empty', '-m', 'feat(graph): add colors')
    git(dir, 'commit', '--allow-empty', '-m', 'plain subject')
    git(dir, 'commit', '--allow-empty', '-m', '[wip] thing')
    return dir
  }

  it('B2: 搜索按字面匹配——正则元字符不再吞匹配(feat(graph) 可命中)', async () => {
    const dir = await repoWithRegexSubjects()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: 'feat(graph)' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits.map((c) => c.subject)).toEqual(['feat(graph): add colors'])
    expect(result.value.total).toBe(1)
  })

  it('B2: 不平衡正则不再使查询失败(按字面字符搜索,ok 且不 fatal)', async () => {
    const dir = await repoWithRegexSubjects()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: '(' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    // 字面 '(' 命中含括号的主题(feat(graph));旧 ERE 实现下 git fatal 整查询失败。
    expect(result.value.commits.map((c) => c.subject)).toEqual(['feat(graph): add colors'])
  })

  it('B2: 字面搜索保持大小写不敏感', async () => {
    const dir = await repoWithRegexSubjects()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: 'FEAT(GRAPH)' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits.map((c) => c.subject)).toEqual(['feat(graph): add colors'])
  })

  it('B2: author 含正则元字符按字面匹配(点号不通配、未配对 [ 不 fatal)', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, '-c', 'user.name=A.B', 'commit', '--allow-empty', '-m', 'by dotted')
    git(dir, '-c', 'user.name=AXB', 'commit', '--allow-empty', '-m', 'by wildcard lookalike')
    // 字面 A.B 只命中 A.B(旧 BRE 实现里 '.' 通配,AXB 也被计入)。
    const dotted = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, author: 'A.B' }))
    expect(dotted.ok).toBe(true)
    if (!dotted.ok || dotted.value.kind !== 'history') return
    expect(dotted.value.total).toBe(1)
    expect(dotted.value.commits[0]?.subject).toBe('by dotted')
    // 未配对 '[' 的作者名:字面匹配不 fatal(旧实现 git fatal → 整查询失败)。
    const bracket = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, author: 'No[body' }))
    expect(bracket.ok).toBe(true)
  })

  it('B2 交互: 搜索+作者组合时两者的字面转义同时生效(无 -F 波及)', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, '-c', 'user.name=A.B', 'commit', '--allow-empty', '-m', 'feat(graph): dotted author')
    git(dir, '-c', 'user.name=Test User', 'commit', '--allow-empty', '-m', 'feat(graph): plain author')
    // 组合过滤:搜索含括号 + 作者含点号。回归:git 的 --fixed-strings 会同时
    // 作用于 --author,使转义后的 A\.B 被当字面反斜杠而失配(复审发现的交互坑),
    // 故字面化统一走 BRE+escapeBre,不使用 -F。
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: 'feat(graph)', author: 'A.B' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits.map((c) => c.subject)).toEqual(['feat(graph): dotted author'])
    expect(result.value.total).toBe(1)
  })

  it('B3: merge 提交的详情列出首父差异(不再恒空)', async () => {
    const dir = await repoWithMerge()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: head }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'show') return
    // 旧实现:combined diff 对干净 merge 输出 0 字节 → stats 恒空。
    // 修复:--first-parent 列出合并引入的 f.txt(IDEA 语义)。
    expect(result.value.stats).toEqual([{ path: 'f.txt', status: 'added' }])
  })

  it('B3: 单父提交的 show 统计不受 --first-parent 影响', async () => {
    const dir = await repoWithCommits()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'show', ref: head }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'show') return
    expect(result.value.stats).toEqual([{ path: 'b.txt', status: 'added' }])
  })

  it('B6: 哈希精准定位不附加 author/since 过滤(深链不被内容过滤滤没)', async () => {
    const dir = await repoWithCommits()
    const head = git(dir, 'rev-parse', 'HEAD').trim()
    // 目标提交作者为 Test User;author=Nobody 若被附加,目标提交被滤没(旧实现)。
    const result = await runQuery(depsFor(dir), CONFIG, request('s1', { kind: 'history', limit: 10, skip: 0, search: head.slice(0, 7), author: 'Nobody' }))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'history') return
    expect(result.value.commits[0]?.hash).toBe(head)
    expect(result.value.total).toBe(1)
  })
})
