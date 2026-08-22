import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitController, type GitRemoteEnvelope, type GitRemoteLike } from '../../src/client/controller.ts'
import type { GitActionResult, GitQueryResponse, GitSnapshot, GitSnapshotResult, GitStorageReadResult, GitStorageWriteResult } from '../../src/host/types.ts'

/** Business-result helpers wrapped in the RPC envelope the gateway returns. */
const ok = (value: GitSnapshotResult): GitRemoteEnvelope<GitSnapshotResult> => ({ ok: true, value })
const okResult = (s: GitSnapshot): GitRemoteEnvelope<GitSnapshotResult> => ok({ ok: true, value: s })
const okRun = (value: GitActionResult): GitRemoteEnvelope<GitActionResult> => ({ ok: true, value })
const okQuery = (value: Extract<GitQueryResponse, { ok: true }>['value']): GitRemoteEnvelope<GitQueryResponse> => ({ ok: true, value: { ok: true, value } })

/** Programmable fake Remote namespace (returns the real RPC envelope shape). */
class FakeRemote implements GitRemoteLike {
  calls = 0
  runCalls = 0
  queryCalls = 0
  private queue: Array<GitRemoteEnvelope<GitSnapshotResult> | Error> = []
  private runQueue: Array<GitRemoteEnvelope<GitActionResult> | Error> = []
  private queryQueue: Array<GitRemoteEnvelope<GitQueryResponse> | Error> = []

  enqueue(result: GitRemoteEnvelope<GitSnapshotResult> | Error): void {
    this.queue.push(result)
  }

  enqueueRun(result: GitRemoteEnvelope<GitActionResult> | Error): void {
    this.runQueue.push(result)
  }

  enqueueQuery(result: GitRemoteEnvelope<GitQueryResponse> | Error): void {
    this.queryQueue.push(result)
  }

  snapshot(): Promise<GitRemoteEnvelope<GitSnapshotResult>> {
    this.calls += 1
    const next = this.queue.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) return Promise.reject(new Error('FakeRemote: queue exhausted'))
    return Promise.resolve(next)
  }

  run(): Promise<GitRemoteEnvelope<GitActionResult>> {
    this.runCalls += 1
    const next = this.runQueue.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) return Promise.reject(new Error('FakeRemote: run queue exhausted'))
    return Promise.resolve(next)
  }

  query(): Promise<GitRemoteEnvelope<GitQueryResponse>> {
    this.queryCalls += 1
    const next = this.queryQueue.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) return Promise.reject(new Error('FakeRemote: query queue exhausted'))
    return Promise.resolve(next)
  }

  /** Storage stubs: no-op success（控制器不消费；存储行为由 settings 测试覆盖）。 */
  storageRead(): Promise<GitRemoteEnvelope<GitStorageReadResult>> {
    return Promise.resolve({ ok: true, value: { ok: true, value: null } })
  }

  storageWrite(): Promise<GitRemoteEnvelope<GitStorageWriteResult>> {
    return Promise.resolve({ ok: true, value: { ok: true } })
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
    remote.enqueue(okResult(snapshot()))
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
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    expect(seen).toContain('ready')
  })

  it('maps a terminal no-cwd failure to a low-frequency probe that recovers', async () => {
    remote.enqueue(ok(UNAVAILABLE))
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'no-cwd' })
    // No probe before the 60s NO_CWD_POLL_MS window.
    await vi.advanceTimersByTimeAsync(59_999)
    expect(remote.calls).toBe(1)
    // First probe fires at 60s; still no cwd → stays no-cwd.
    remote.enqueue(ok(UNAVAILABLE))
    await vi.advanceTimersByTimeAsync(1)
    await tick()
    expect(remote.calls).toBe(2)
    expect(controller.getSnapshot()).toEqual({ state: 'no-cwd' })
    // A later probe finds a working directory → ready, normal polling resumes.
    remote.enqueue(okResult(snapshot()))
    await vi.advanceTimersByTimeAsync(60_000)
    await tick()
    expect(remote.calls).toBe(3)
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('polls at the snapshot interval and skips busy ticks', async () => {
    remote.enqueue(okResult(snapshot({ refreshIntervalMs: 10_000 })))
    controller.ensure()
    await tick()
    expect(remote.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(remote.calls).toBe(1)
    remote.enqueue(okResult(snapshot({ refreshIntervalMs: 10_000 })))
    await vi.advanceTimersByTimeAsync(1)
    await tick()
    expect(remote.calls).toBe(2)
    // The next poll fires after another interval and consumes the queue.
    remote.enqueue(okResult(snapshot({ refreshIntervalMs: 10_000 })))
    await vi.advanceTimersByTimeAsync(10_000)
    await tick()
    expect(remote.calls).toBe(3)
  })

  it('does not poll when the interval is 0', async () => {
    remote.enqueue(okResult(snapshot({ refreshIntervalMs: 0 })))
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.calls).toBe(1)
  })

  it('shows an error view for non-terminal failures and keeps polling', async () => {
    remote.enqueue(ok(NOT_A_REPO))
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'error', error: { code: 'not-a-git-repo' } })
    remote.enqueue(okResult(snapshot()))
    await vi.advanceTimersByTimeAsync(30_000)
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('recovers after a timeout failure', async () => {
    remote.enqueue(ok(TIMEOUT))
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toEqual({ state: 'error', error: { code: 'timeout' } })
    remote.enqueue(okResult(snapshot()))
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
    remote.enqueue(okResult(snapshot()))
    await vi.advanceTimersByTimeAsync(30_000)
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
  })

  it('resync() refreshes after a connection reset', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    remote.enqueue(okResult(snapshot()))
    controller.resync()
    await tick()
    expect(remote.calls).toBe(2)
  })

  it('resync() does not wake a terminal no-cwd controller', async () => {
    remote.enqueue(ok(UNAVAILABLE))
    controller.ensure()
    await tick()
    controller.resync()
    await tick()
    expect(remote.calls).toBe(1)
  })

  it('dispose() stops polling and silences in-flight settlement', async () => {
    let resolveSnapshot: (r: GitRemoteEnvelope<GitSnapshotResult>) => void = () => {}
    const pending = new Promise<GitRemoteEnvelope<GitSnapshotResult>>((resolve) => { resolveSnapshot = resolve })
    remote.enqueue(pending as unknown as GitRemoteEnvelope<GitSnapshotResult>)
    controller.ensure()
    controller.dispose()
    resolveSnapshot(okResult(snapshot()))
    await tick()
    // The settled result must not flip the view after dispose.
    expect(controller.getSnapshot()).toEqual({ state: 'loading' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.calls).toBe(1)
  })

  it('run() applies the returned snapshot to the view immediately', async () => {
    const after = snapshot({ staged: 1, dirty: true, changes: [{ path: 'a.txt', status: 'modified', staged: true, isDirectory: false }] })
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    remote.enqueueRun(okRun({ ok: true, snapshot: after }))
    const result = await controller.run({ kind: 'stage', paths: ['a.txt'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const view = controller.getSnapshot()
    expect(view.state).toBe('ready')
    if (view.state === 'ready') expect(view.snapshot.staged).toBe(1)
    expect(remote.runCalls).toBe(1)
  })

  it('run() surfaces a git-error without losing the last ready view', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    remote.enqueueRun(okRun({ ok: false, error: { code: 'git-error', message: 'nothing to commit' } }))
    const result = await controller.run({ kind: 'commit', message: 'x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('git-error')
    // The last ready snapshot stays visible (plus a background refresh kick).
    const view = controller.getSnapshot()
    expect(view.state).toBe('ready')
    if (view.state === 'ready') expect(view.snapshot.dirty).toBe(false)
  })

  it('run() queues behind an in-flight refresh (single-flight)', async () => {
    let resolveSnapshot: (r: GitRemoteEnvelope<GitSnapshotResult>) => void = () => {}
    const pending = new Promise<GitRemoteEnvelope<GitSnapshotResult>>((resolve) => { resolveSnapshot = resolve })
    remote.enqueue(pending as unknown as GitRemoteEnvelope<GitSnapshotResult>)
    controller.ensure()
    await tick()
    remote.enqueueRun(okRun({ ok: true, snapshot: snapshot() }))
    const runPromise = controller.run({ kind: 'stage-all' })
    // Still queued while the refresh is in flight.
    expect(remote.runCalls).toBe(0)
    resolveSnapshot(okResult(snapshot()))
    const result = await runPromise
    expect(result.ok).toBe(true)
    expect(remote.runCalls).toBe(1)
  })

  it('query() unwraps a successful result without touching the view', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    remote.enqueueQuery(okQuery({ kind: 'branches', current: 'main', defaultBranch: 'main', local: [{ name: 'main', shortHash: 'abc1234' }], remote: [] }))
    const outcome = await controller.query({ kind: 'branches' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.kind).toBe('branches')
    if (outcome.value.kind !== 'branches') return
    expect(outcome.value.current).toBe('main')
    // The snapshot view is unchanged by a query.
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    expect(remote.queryCalls).toBe(1)
  })

  it('query() surfaces a business error message', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    remote.enqueueQuery({ ok: true, value: { ok: false, error: { code: 'git-error', message: 'bad ref' } } })
    const outcome = await controller.query({ kind: 'show', ref: 'nope' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.message).toContain('bad ref')
  })

  it('query() maps a transport rejection to a message', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    remote.enqueueQuery(new Error('network down'))
    const outcome = await controller.query({ kind: 'branches' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.message).toContain('network down')
  })
})
