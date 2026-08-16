import { afterEach, describe, expect, it } from 'vitest'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner } from '../src/host/git.ts'
import { runAction } from '../src/host/actions.ts'
import { normalizeConfig, type SnapshotDeps } from '../src/host/core.ts'
import type { GitRunResult } from '../src/host/git.ts'
import type { GitActionRequest } from '../src/host/types.ts'
import { git, gitInit, makeTempDir, realSubprocess } from './helpers.ts'

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
