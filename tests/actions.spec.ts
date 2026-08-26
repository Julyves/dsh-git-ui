import { afterEach, describe, expect, it } from 'vitest'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner } from '../src/host/git.ts'
import { runAction } from '../src/host/actions.ts'
import { normalizeConfig, type SnapshotDeps } from '../src/host/core.ts'
import type { GitRunResult } from '../src/host/git.ts'
import type { GitActionRequest } from '../src/host/types.ts'
import { git, gitInit, gitStatus, makeTempDir, realSubprocess } from './helpers.ts'

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

/** Build deps over the real git binary for a session rooted at `cwd`. */
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

/** Dirty a repo: modify a tracked file, add a new tracked file, and create an untracked file. */
async function makeDirty(dir: string): Promise<void> {
  await writeFile(join(dir, 'readme.txt'), 'changed\n')
  await writeFile(join(dir, 'new.txt'), 'hello\n')
  await writeFile(join(dir, 'untracked.txt'), 'u\n')
}

const request = (sessionId: string, action: GitActionRequest['action']): GitActionRequest => ({ sessionId, action })

describe('runAction — stage / unstage', () => {
  it('stages listed paths only and refreshes the snapshot', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'stage', paths: ['readme.txt', 'new.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.staged).toBe(2)
    expect(result.snapshot.untracked).toBe(1)
    expect(result.snapshot.changes.find((c) => c.path === 'readme.txt')?.staged).toBe(true)
    expect(result.snapshot.changes.find((c) => c.path === 'untracked.txt')?.staged).toBe(false)
  })

  it('stages everything with stage-all', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'stage-all' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ staged: 3, modified: 0, untracked: 0 })
  })

  it('unstages listed paths', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'readme.txt'), 'changed\n')
    git(dir, 'add', 'readme.txt')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'unstage', paths: ['readme.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ staged: 0, modified: 1 })
  })

  it('unstages everything with unstage-all', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'readme.txt'), 'changed\n')
    await writeFile(join(dir, 'new.txt'), 'x\n')
    git(dir, 'add', '.')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'unstage-all' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.staged).toBe(0)
  })

  // C3 回归：unborn 仓库（首次提交前）的取消暂存。restore --staged 以 HEAD
  // 为参照、无 HEAD 必败（fatal: could not resolve HEAD）——修复后改用
  // rm --cached 移出索引，文件回到未跟踪。
  it('unstages listed paths in an unborn repository (no HEAD yet)', async () => {
    const dir = await tempDir()
    await gitInit(dir, { commit: false })
    await writeFile(join(dir, 'a.txt'), 'hello\n')
    git(dir, 'add', 'a.txt')
    expect(gitStatus(dir, 'status', '--porcelain').stdout).toContain('A  a.txt')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'unstage', paths: ['a.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ unborn: true, staged: 0, untracked: 1 })
  })

  it('unstages everything in an unborn repository with unstage-all', async () => {
    const dir = await tempDir()
    await gitInit(dir, { commit: false })
    await writeFile(join(dir, 'a.txt'), 'a\n')
    await writeFile(join(dir, 'b.txt'), 'b\n')
    git(dir, 'add', '.')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'unstage-all' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ unborn: true, staged: 0, untracked: 2 })
  })
})

describe('runAction — discard', () => {
  it('restores a modified tracked file and refreshes the snapshot', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'readme.txt'), 'changed\n')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'discard', paths: ['readme.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.dirty).toBe(false)
    expect(await readFile(join(dir, 'readme.txt'), 'utf8')).toBe('hello\n')
  })

  it('discards all tracked changes with discard-all but keeps untracked files', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    git(dir, 'add', 'new.txt')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'discard-all' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // readme.txt restored; new.txt (was staged added) returns to untracked;
    // untracked.txt untouched — both stay as untracked files.
    expect(result.snapshot).toMatchObject({ staged: 0, modified: 0, untracked: 2 })
    expect(result.snapshot.changes.map((c) => c.path).sort()).toEqual(['new.txt', 'untracked.txt'])
  })
})

describe('runAction — commit', () => {
  it('commits everything staged with a message', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'new.txt'), 'hello\n')
    git(dir, 'add', 'new.txt')
    const before = git(dir, 'rev-parse', '--short', 'HEAD').trim()
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'second commit' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ staged: 0, dirty: false })
    expect(result.snapshot.head).not.toBe(before)
    expect(result.snapshot.lastCommit?.subject).toBe('second commit')
  })

  it('commits only the selected paths (IDE-style)', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'partial', paths: ['readme.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.lastCommit?.subject).toBe('partial')
    // Only readme.txt was committed; new.txt and untracked.txt remain.
    expect(result.snapshot.changes.map((c) => c.path).sort()).toEqual(['new.txt', 'untracked.txt'])
  })

  it('commits a selection that includes untracked files and keeps other staged files', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    git(dir, 'add', 'new.txt')
    // 未跟踪文件裸路径无法被 commit pathspec 匹配（旧实现此处必失败）；
    // 两步序列后仅所选路径入提交，无关已暂存文件保留。
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'mixed selection', paths: ['readme.txt', 'untracked.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.lastCommit?.subject).toBe('mixed selection')
    expect(result.snapshot).toMatchObject({ staged: 1, modified: 0, untracked: 0 })
    expect(result.snapshot.changes.map((c) => c.path)).toEqual(['new.txt'])
  })

  it('commits a mixed-state file selection with work tree content', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'readme.txt'), 'staged line\n')
    git(dir, 'add', 'readme.txt')
    await writeFile(join(dir, 'readme.txt'), 'staged line\nworktree line\n')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'mm commit', paths: ['readme.txt'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({ staged: 0, modified: 0, dirty: false })
    // 路径限定提交取工作区内容（已暂存 + 未暂存两侧一并入提交）。
    expect(git(dir, 'show', 'HEAD:readme.txt')).toBe('staged line\nworktree line\n')
  })

  it('keeps selected paths staged when the commit step fails after add', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await makeDirty(dir)
    // 阻断式 pre-commit 钩子：add 已生效，commit 被拒——所选路径应留在暂存区。
    await writeFile(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n')
    await chmod(join(dir, '.git', 'hooks', 'pre-commit'), 0o755)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'blocked', paths: ['readme.txt', 'untracked.txt'] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('git-error')
    const status = gitStatus(dir, 'status', '--porcelain=v1')
    expect(status.stdout).toContain('M  readme.txt')
    expect(status.stdout).toContain('A  untracked.txt')
  })

  it('rejects an empty message with git-error', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: '   ' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('git-error')
  })

  it('surfaces a git error when there is nothing to commit', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'commit', message: 'noop' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('git-error')
      expect(result.error.message).toContain('nothing to commit')
    }
  })
})

describe('runAction — path safety', () => {
  it('rejects paths escaping the work tree', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    for (const path of ['../escape.txt', '/abs/path.txt', '', 'C:\\evil.txt']) {
      const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'stage', paths: [path] }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid-path')
    }
  })

  it('rejects an empty path list', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'stage', paths: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-path')
  })
})

describe('runAction — failure codes', () => {
  it('returns not-a-git-repo for a plain directory', async () => {
    const dir = await tempDir()
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'stage-all' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-a-git-repo')
  })

  it('returns timeout when the action command times out', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const fake = {
      run(argv: readonly string[], _opts: { cwd: string }): Promise<GitRunResult> {
        if (argv[1] === 'add') return Promise.resolve({ exitCode: null, stdout: '', stderr: '', timedOut: true, stdoutLossy: false })
        // Delegate everything else to a live runner so workspace resolution works.
        return createGitRunner(realSubprocess(), CONFIG.timeoutMs, CONFIG.maxStatusBytes).run(argv, _opts)
      },
    }
    const result = await runAction({ ...depsFor(dir), run: fake }, CONFIG, request('s1', { kind: 'stage-all' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('timeout')
  })
})

describe('runAction — branches', () => {
  it('creates a branch from HEAD by default', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-create', name: 'feature/new' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.branch).toBe('main') // still on main
    expect(git(dir, 'branch', '--list', 'feature/new')).toContain('feature/new')
  })

  it('creates a branch from a named starting point', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, 'checkout', '-b', 'base')
    await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-create', name: 'derived', from: 'base' }))
    expect(git(dir, 'branch', '--list', 'derived')).toContain('derived')
  })

  it('checks out an existing branch and refreshes the snapshot', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, 'branch', 'other')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-checkout', name: 'other' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.branch).toBe('other')
  })

  it('classifies a dirty-tree checkout collision as local-changes-block (friendly alert)', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    // Give `other` divergent content so the checkout really conflicts.
    git(dir, 'checkout', '-b', 'other')
    await writeFile(join(dir, 'readme.txt'), 'other version\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'other change')
    git(dir, 'checkout', 'main')
    await writeFile(join(dir, 'readme.txt'), 'dirty local change\n')
    const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-checkout', name: 'other' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 可预期业务失败：专用 code（client 映射友好文案 + 处理变更引导），
      // 原始 git 信息仍保留在 message 供查看。
      expect(result.error.code).toBe('local-changes-block')
      expect(result.error.message).toMatch(/overwritten by checkout/i)
    }
  })

  it('deletes a merged branch safely and refuses the current branch', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    git(dir, 'branch', 'merged')
    const deleted = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-delete', name: 'merged' }))
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(git(dir, 'branch', '--list', 'merged')).toBe('')

    const current = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-delete', name: 'main' }))
    expect(current.ok).toBe(false)
    if (!current.ok) expect(current.error.code).toBe('git-error')
  })

  it('rejects invalid branch names with invalid-name', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    for (const name of ['-bad', 'a..b', 'bad//name', 'trailing/', 'has space', '']) {
      const result = await runAction(depsFor(dir), CONFIG, request('s1', { kind: 'branch-create', name }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid-name')
    }
  })
})
