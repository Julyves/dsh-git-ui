import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitController, type GitRemoteLike } from '../../src/client/controller.ts'
import type { GitSnapshot, GitSnapshotResult } from '../../src/host/types.ts'

/** Programmable fake Remote namespace. */
class FakeRemote implements GitRemoteLike {
  calls = 0
  private queue: Array<GitSnapshotResult | Error> = []

  enqueue(result: GitSnapshotResult | Error): void {
    this.queue.push(result)
  }

  snapshot(): Promise<GitSnapshotResult> {
    this.calls += 1
    const next = this.queue.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) return Promise.reject(new Error('FakeRemote: queue exhausted'))
    return Promise.resolve(next)
  }
}

function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false, dirty: false,
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [], changes: [], truncated: false,
    refreshIntervalMs: 30_000, checkedAt: 1_700_000_000_000,
    ...overrides,
  }
}

const UNAVAILABLE: GitSnapshotResult = { ok: false, error: { code: 'cwd-unavailable', sessionId: 's1' } }
const NOT_A_REPO: GitSnapshotResult = { ok: false, error: { code: 'not-a-git-repo' } }
const TIMEOUT: GitSnapshotResult = { ok: false, error: { code: 'timeout' } }

/** Drain the microtask queue (fake timers intercept setTimeout, so no macrotasks). */
const tick = (): Promise<void> => Promise.resolve().then(() => Promise.resolve())

describe('GitController', () => {
  let remote: FakeRemote
  let controller: GitController

  beforeEach(() => {
    vi.useFakeTimers()
    remote = new FakeRemote()
    controller = new GitController(remote, 's1')
  })

  afterEach(() => {
    controller.dispose()
    vi.useRealTimers()
  })

  it('starts cold and stays cold until ensure()', async () => {
    expect(controller.getSnapshot()).toEqual({ state: 'cold' })
    await tick()
    expect(remote.calls).toBe(0)
  })

  it('ensure() loads once and reaches ready', async () => {
    remote.enqueue({ ok: true, value: snapshot() })
    controller.ensure()
    expect(controller.getSnapshot()).toEqual({ state: 'loading' })
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    expect(remote.calls).toBe(1)
    controller.ensure()
    await tick()
    expect(remote.calls).toBe(1)
  })

  it('notifies subscribers on view changes', async () => {
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().state))
    remote.enqueue({ ok: true, value: snapshot() })
    controller.ensure()
    await tick()
    expect(seen).toContain('ready')
  })

  it('maps a terminal no-cwd failure and stops polling', async () => {
    remote.enqueue(UNAVAILABLE)
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'no-cwd' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.calls).toBe(1)
  })

  it('polls at the snapshot interval and skips busy ticks', async () => {
    remote.enqueue({ ok: true, value: snapshot({ refreshIntervalMs: 10_000 }) })
    controller.ensure()
    await tick()
    expect(remote.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(remote.calls).toBe(1)
    remote.enqueue({ ok: true, value: snapshot({ refreshIntervalMs: 10_000 }) })
    await vi.advanceTimersByTimeAsync(1)
    await tick()
    expect(remote.calls).toBe(2)
    // The next poll fires after another interval and consumes the queue.
    remote.enqueue({ ok: true, value: snapshot({ refreshIntervalMs: 10_000 }) })
    await vi.advanceTimersByTimeAsync(10_000)
    await tick()
    expect(remote.calls).toBe(3)
  })

  it('does not poll when the interval is 0', async () => {
    remote.enqueue({ ok: true, value: snapshot({ refreshIntervalMs: 0 }) })
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.calls).toBe(1)
  })

  it('shows an error view for non-terminal failures and keeps polling', async () => {
    remote.enqueue(NOT_A_REPO)
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'error', error: { code: 'not-a-git-repo' } })
    remote.enqueue({ ok: true, value: snapshot() })
    await vi.advanceTimersByTimeAsync(30_000)
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('recovers after a timeout failure', async () => {
    remote.enqueue(TIMEOUT)
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'error', error: { code: 'timeout' } })
    remote.enqueue({ ok: true, value: snapshot() })
    await vi.advanceTimersByTimeAsync(30_000)
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('maps a transport rejection to an error view and keeps polling', async () => {
    remote.enqueue(new Error('network down'))
    controller.ensure()
    await tick()
    const view = controller.getSnapshot()
    expect(view.state).toBe('error')
    if (view.state === 'error') expect(view.error.code).toBe('git-unavailable')
    remote.enqueue({ ok: true, value: snapshot() })
    await vi.advanceTimersByTimeAsync(30_000)
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('resync() refreshes after a connection reset', async () => {
    remote.enqueue({ ok: true, value: snapshot() })
    controller.ensure()
    await tick()
    remote.enqueue({ ok: true, value: snapshot() })
    controller.resync()
    await tick()
    expect(remote.calls).toBe(2)
  })

  it('resync() does not wake a terminal no-cwd controller', async () => {
    remote.enqueue(UNAVAILABLE)
    controller.ensure()
    await tick()
    controller.resync()
    await tick()
    expect(remote.calls).toBe(1)
  })

  it('dispose() stops polling and silences in-flight settlement', async () => {
    let resolveSnapshot: (r: GitSnapshotResult) => void = () => {}
    const pending = new Promise<GitSnapshotResult>((resolve) => { resolveSnapshot = resolve })
    remote.enqueue(pending as unknown as GitSnapshotResult)
    controller.ensure()
    controller.dispose()
    resolveSnapshot({ ok: true, value: snapshot() })
    await tick()
    // The settled result must not flip the view after dispose.
    expect(controller.getSnapshot()).toEqual({ state: 'loading' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.calls).toBe(1)
  })
})
