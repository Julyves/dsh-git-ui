import { afterEach, describe, expect, it } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner } from '../src/host/git.ts'
import { normalizeConfig, snapshotForSession, type GitStatusConfig, type SessionLookup, type SnapshotDeps } from '../src/host/core.ts'
import type { GitRunResult } from '../src/host/git.ts'
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

const CONFIG: GitStatusConfig = {
  timeoutMs: 5000,
  maxStatusBytes: 4 * 1024 * 1024,
  maxChanges: 100,
  defaultRefreshIntervalMs: 30_000,
}

/** Programmable runner for failure-path tests. */
class FakeRunner {
  private readonly queue: Map<string, GitRunResult> = new Map()
  throwOn: string[] = []

  on(argv: readonly string[], result: GitRunResult): void {
    this.queue.set(argv.join(' '), result)
  }

  run(argv: readonly string[], _opts: { cwd: string }): Promise<GitRunResult> {
    const key = argv.join(' ')
    if (this.throwOn.includes(key)) return Promise.reject(new Error(`spawn failed: ${key}`))
    const result = this.queue.get(key)
    if (result === undefined) throw new Error(`FakeRunner: no preset for ${key}`)
    return Promise.resolve(result)
  }
}

/** Session lookup pointing every session at one fixed cwd. */
function fixedSession(cwd: string | undefined): SessionLookup {
  return {
    liveCwd: () => cwd,
    persistedMeta: async () => (cwd === undefined ? { cwd: undefined } : { cwd }),
  }
}

/** Missing session: no live entry and no persisted record. */
const MISSING_SESSION: SessionLookup = {
  liveCwd: () => undefined,
  persistedMeta: async () => undefined,
}

/** Build real deps over the real git binary with an optional fake runner. */
function depsFor(
  cwd: string | undefined,
  sessions: SessionLookup = fixedSession(cwd),
  runner = createGitRunner(realSubprocess(), CONFIG.timeoutMs, CONFIG.maxStatusBytes),
): SnapshotDeps {
  return { run: runner, fs: { realpath, stat }, sessions }
}

describe('normalizeConfig', () => {
  it('applies defaults for empty input', () => {
    expect(normalizeConfig(undefined)).toEqual(CONFIG)
    expect(normalizeConfig({})).toEqual(CONFIG)
  })

  it('keeps valid values and coerces invalid ones', () => {
    expect(normalizeConfig({ timeoutMs: 100, maxChanges: 5, defaultRefreshIntervalMs: 0 })).toEqual({
      timeoutMs: 100, maxStatusBytes: CONFIG.maxStatusBytes, maxChanges: 5, defaultRefreshIntervalMs: 0,
    })
    expect(normalizeConfig({ timeoutMs: -1, maxChanges: 'x', maxStatusBytes: NaN }).timeoutMs).toBe(CONFIG.timeoutMs)
    expect(normalizeConfig({ timeoutMs: 0, maxChanges: 2.9 })).toMatchObject({ timeoutMs: 5000, maxChanges: 2 })
  })
})

describe('snapshotForSession — failure codes', () => {
  it('returns session-not-found when no live or persisted session exists', async () => {
    const result = await snapshotForSession(depsFor(undefined, MISSING_SESSION), CONFIG, 's1')
    expect(result).toEqual({ ok: false, error: { code: 'session-not-found', sessionId: 's1' } })
  })

  it('returns cwd-unavailable when the session has no cwd', async () => {
    const result = await snapshotForSession(depsFor(undefined), CONFIG, 's1')
    expect(result).toEqual({ ok: false, error: { code: 'cwd-unavailable', sessionId: 's1' } })
  })

  it('returns path-not-found when the cwd does not exist', async () => {
    const missing = join(await tempDir(), 'does-not-exist')
    const result = await snapshotForSession(depsFor(missing), CONFIG, 's1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('path-not-found')
  })

  it('returns not-a-git-repo for a plain directory', async () => {
    const dir = await tempDir()
    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result).toEqual({ ok: false, error: { code: 'not-a-git-repo' } })
  })

  it('returns git-unavailable when the run rejects (git missing)', async () => {
    const dir = await tempDir()
    const fake = new FakeRunner()
    fake.throwOn = ['git rev-parse --show-toplevel']
    const result = await snapshotForSession(depsFor(dir, fixedSession(dir), fake as unknown as SnapshotDeps['run']), CONFIG, 's1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('git-unavailable')
  })

  it('returns timeout when the toplevel probe times out', async () => {
    const dir = await tempDir()
    const fake = new FakeRunner()
    fake.on(['git', 'rev-parse', '--show-toplevel'], { exitCode: null, stdout: '', stderr: '', timedOut: true, stdoutLossy: false })
    const result = await snapshotForSession(depsFor(dir, fixedSession(dir), fake as unknown as SnapshotDeps['run']), CONFIG, 's1')
    expect(result).toEqual({ ok: false, error: { code: 'timeout' } })
  })
})

describe('snapshotForSession — real repositories', () => {
  it('captures a clean repository', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // git reports the toplevel through its own path resolution; macOS /var is
    // a symlink to /private/var, so compare against the realpath.
    expect(result.value.root).toBe(await realpath(dir))
    expect(result.value.head).toMatch(/^[0-9a-f]{7,}$/)
    expect(result.value.recentCommits).toHaveLength(1)
    expect(result.value.lastCommit?.subject).toBe('initial commit')
    expect(result.value.checkedAt).toBeGreaterThan(0)
  })

  it('captures dirty state: modified, staged, untracked', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, 'readme.txt'), 'changed\n')
    await writeFile(join(dir, 'new.txt'), 'untracked\n')
    let result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ dirty: true, modified: 1, untracked: 1, staged: 0 })

    git(dir, 'add', 'readme.txt')
    result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    if (!result.ok) return
    expect(result.value).toMatchObject({ staged: 1, modified: 0, untracked: 1 })
    expect(result.value.changes.map((c) => [c.path, c.status, c.staged])).toEqual([
      ['readme.txt', 'modified', true],
      ['new.txt', 'untracked', false],
    ])
  })

  it('captures ahead counts against a bare remote', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await addBareRemote(dir)
    await writeFile(join(dir, 'second.txt'), 'two\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'second commit')
    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ ahead: 1, behind: 0 })
    expect(result.value.recentCommits).toHaveLength(2)
  })

  it('captures a detached HEAD', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const hash = git(dir, 'rev-parse', 'HEAD').trim()
    git(dir, 'checkout', '--detach', hash)
    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.branch).toBeNull()
    expect(result.value.head).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('captures an unborn repository (no commits)', async () => {
    const dir = await tempDir()
    await gitInit(dir, { commit: false })
    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ unborn: true, head: null, dirty: false })
    expect(result.value.recentCommits).toEqual([])
    expect(result.value.lastCommit).toBeNull()
  })

  it('marks truncated when the status output overflowed its byte cap', async () => {
    const dir = await tempDir()
    const fake = new FakeRunner()
    fake.on(['git', 'rev-parse', '--show-toplevel'], { exitCode: 0, stdout: `${dir}\n`, stderr: '', timedOut: false, stdoutLossy: false })
    fake.on(['git', 'branch', '--show-current'], { exitCode: 0, stdout: 'main\n', stderr: '', timedOut: false, stdoutLossy: false })
    fake.on(['git', 'rev-parse', '--short', 'HEAD'], { exitCode: 0, stdout: 'abc1234\n', stderr: '', timedOut: false, stdoutLossy: false })
    fake.on(['git', 'status', '--porcelain=v1', '-z', '--branch'], { exitCode: 0, stdout: '## main\u0000', stderr: '', timedOut: false, stdoutLossy: true })
    fake.on(['git', 'log', '-n', '5', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], { exitCode: 0, stdout: '', stderr: '', timedOut: false, stdoutLossy: false })
    const result = await snapshotForSession(depsFor(dir, fixedSession(dir), fake as unknown as SnapshotDeps['run']), CONFIG, 's1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.truncated).toBe(true)
  })
})
