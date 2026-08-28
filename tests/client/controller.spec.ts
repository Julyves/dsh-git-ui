import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitController, type GitRemoteEnvelope, type GitRemoteLike } from '../../src/client/controller.ts'
import type { GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshot, GitSnapshotResult, GitStorageReadResult, GitStorageWriteResult, GitPresetResult } from '../../src/host/types.ts'

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
  /** watch 长轮询驻留次数(独立计数,不混入业务 queryCalls)。 */
  watchCalls = 0
  private queue: Array<GitRemoteEnvelope<GitSnapshotResult> | Error> = []
  private runQueue: Array<GitRemoteEnvelope<GitActionResult> | Error> = []
  private queryQueue: Array<GitRemoteEnvelope<GitQueryResponse> | Error> = []
  /** 可编程 watch 应答队列;空时驻留至 abort(生产形态)。 */
  private watchQueue: Array<GitRemoteEnvelope<GitQueryResponse> | Error> = []

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

  /**
   * watch kind = 驻留语义(真实宿主挂 25s):挂起至 signal abort——
   * 测试里的 watch 循环因此与生产同形(挂一条、不热转)。业务查询照旧
   * 走可编程队列。
   */
  query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitRemoteEnvelope<GitQueryResponse>> {
    if (request.query.kind === 'watch') {
      this.watchCalls += 1
      const next = this.watchQueue.shift()
      if (next !== undefined) {
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
      }
      // 驻留语义(真实宿主挂 25s):挂起至 signal abort——测试里的 watch
      // 循环因此与生产同形(挂一条、不热转)。
      return new Promise((_resolve, reject) => {
        const abort = (): void => reject(new Error('aborted'))
        if (signal !== undefined) {
          if (signal.aborted) return abort()
          signal.addEventListener('abort', abort, { once: true })
        }
      })
    }
    this.queryCalls += 1
    const next = this.queryQueue.shift()
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) return Promise.reject(new Error('FakeRemote: query queue exhausted'))
    return Promise.resolve(next)
  }

  /** 预置一条 watch 应答(队列消费完后回归驻留形态)。 */
  enqueueWatch(result: GitRemoteEnvelope<GitQueryResponse> | Error): void {
    this.watchQueue.push(result)
  }

  /** Storage stubs: no-op success（控制器不消费；存储行为由 settings 测试覆盖）。 */
  storageRead(): Promise<GitRemoteEnvelope<GitStorageReadResult>> {
    return Promise.resolve({ ok: true, value: { ok: true, value: null } })
  }

  storageWrite(): Promise<GitRemoteEnvelope<GitStorageWriteResult>> {
    return Promise.resolve({ ok: true, value: { ok: true } })
  }

  getPreset(): Promise<GitRemoteEnvelope<GitPresetResult>> {
    return Promise.resolve({ ok: true, value: { ok: true, value: null } })
  }
}

function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false, dirty: false,
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [], changes: [], truncated: false,
    refreshIntervalMs: 30_000, watchVersion: 0, checkedAt: 1_700_000_000_000,
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

  // ── watch 长轮询(事件驱动刷新) ────────────────────────────────────────────

  it('watch 循环:ready 后挂起一条驻留(不额外触发快照)', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    await tick()
    expect(remote.watchCalls).toBe(1)
    expect(remote.calls).toBe(1)
  })

  it('宿主快照无 watchVersion(旧宿主)→ 不启动 watch,纯轮询', async () => {
    const { watchVersion: _omit, ...legacy } = snapshot()
    void _omit
    remote.enqueue(okResult(legacy as GitSnapshot))
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(remote.watchCalls).toBe(0)
    expect(remote.calls).toBeGreaterThanOrEqual(2)
  })

  it('watch changed → 立即全量刷新并携带新版本重挂(刷新后 1s 节流间歇)', async () => {
    // 应答需在首条 watch 发出前预置(ensure 前),否则驻留已挂死。
    remote.enqueueWatch(okQuery({ kind: 'watch', changed: true, version: 4 }))
    remote.enqueue(okResult(snapshot({ watchVersion: 3 })))
    remote.enqueue(okResult(snapshot({ watchVersion: 4 })))
    controller.ensure()
    await tick()
    await tick()
    // refresh 在节流间歇之前执行——快照已两连。
    await tick()
    expect(remote.calls).toBe(2)
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    // 节流间歇(WATCH_SETTLE_MS)后重挂第 2 条(fake timers 需显式推进)。
    await vi.advanceTimersByTimeAsync(1_000)
    expect(remote.watchCalls).toBe(2)
  })

  it('watch unchanged(超时心跳)→ 原样重挂,零快照', async () => {
    remote.enqueueWatch(okQuery({ kind: 'watch', changed: false, version: 0 }))
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    await tick()
    await tick()
    expect(remote.watchCalls).toBe(2)
    expect(remote.calls).toBe(1)
  })

  it('watch 连续失败 5 次 → 终态降级:不再探测,轮询节拍不被重置', async () => {
    for (let i = 0; i < 5; i += 1) remote.enqueueWatch(new Error('transport down'))
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(remote.watchCalls).toBe(5)
    // 终态:推进时间也不再探测;快照轮询照常标准档(30s → 每 30s 一次)。
    await vi.advanceTimersByTimeAsync(60_000)
    expect(remote.watchCalls).toBe(5)
    expect(remote.calls).toBeGreaterThanOrEqual(3)
    expect(remote.calls).toBeLessThanOrEqual(6)
  })

  it('watch 驻留不阻塞 run/query(single-flight 独立)', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    await tick()
    expect(remote.watchCalls).toBe(1)
    // 驻留中:业务操作立即可行(不等 watch)。
    remote.enqueueRun(okRun({ ok: true, snapshot: snapshot({ dirty: true }) }))
    const outcome = await controller.run({ kind: 'stage-all' })
    expect(outcome.ok).toBe(true)
    expect(remote.runCalls).toBe(1)
  })

  it('watch changed + refresh 持续失败 → 计数退避并终态降级,无零退避风暴(复审 R1)', async () => {
    // 场景:宿主重启版本归零 + git 暂不可用——watch 恒报 changed 而
    // refresh 恒败,锚点无法前进。修复前是「watch(0 驻留)→ 全量快照」
    // 紧循环;修复后失败计入降级计数,5 次终态。
    for (let i = 0; i < 12; i += 1) remote.enqueueWatch(okQuery({ kind: 'watch', changed: true, version: 99 }))
    remote.enqueue(okResult(snapshot({ watchVersion: 3 })))
    const GIT_DOWN: GitRemoteEnvelope<GitSnapshotResult> = { ok: true, value: { ok: false, error: { code: 'git-unavailable', detail: 'spawn failed' } } }
    for (let i = 0; i < 12; i += 1) remote.enqueue(GIT_DOWN)
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(30_000)
    // 5 次失败即终态:watch 与快照均有界(紧循环下会是数十次)。
    expect(remote.watchCalls).toBe(5)
    expect(remote.calls).toBe(6)
    expect(controller.getSnapshot()).toMatchObject({ state: 'error' })
    // 终态后推进时间不再增长。
    await vi.advanceTimersByTimeAsync(30_000)
    expect(remote.watchCalls).toBe(5)
  })

  it('R1 计数语义:健康往返清零——故障后恢复不误降级', async () => {
    // 全量预载应答(驻留形态下无法中途注入):3 次 changed+刷新失败
    // (failures=3)→ 1 次健康往返(changed+刷新成功,清零回 ready)→
    // 2 次瞬时 transport 失败(累计 2 < 5,不误降级)→ 队列耗尽回驻留。
    remote.enqueue(okResult(snapshot({ watchVersion: 3 })))
    for (let i = 0; i < 3; i += 1) {
      remote.enqueueWatch(okQuery({ kind: 'watch', changed: true, version: 9 }))
      remote.enqueue({ ok: true, value: { ok: false, error: { code: 'timeout' } } })
    }
    remote.enqueueWatch(okQuery({ kind: 'watch', changed: true, version: 4 }))
    remote.enqueue(okResult(snapshot({ watchVersion: 4 })))
    remote.enqueueWatch(new Error('t1'))
    remote.enqueueWatch(new Error('t2'))
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(8_000)
    // 退避时序断言(链A P1-1 回归锁):3 次失败各隔 3s——零退避紧循环
    // 会在 8s 内消费完全部应答。
    expect(remote.watchCalls).toBe(3)
    await vi.advanceTimersByTimeAsync(12_000)
    // 时间线:3 次失败(3×3s 退避)→ 健康往返(刷新+1s 节流)→ 2 次失败
    // 退避 → 驻留。watch 共 7 次调用,视图恢复 ready,终态未触发。
    expect(remote.watchCalls).toBe(7)
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(remote.watchCalls).toBe(7)
  })

  it('changed 后仓库消失(no-cwd)→ watch 循环退出,交给低频探测(复审 P2-1)', async () => {
    remote.enqueue(okResult(snapshot({ watchVersion: 3 })))
    remote.enqueueWatch(okQuery({ kind: 'watch', changed: true, version: 4 }))
    remote.enqueue(ok(UNAVAILABLE))
    controller.ensure()
    await tick()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(controller.getSnapshot()).toMatchObject({ state: 'no-cwd' })
    // 循环退出:不再重挂(no-cwd 60s 低频探测负责恢复)。
    expect(remote.watchCalls).toBe(1)
  })

  it('dispose 中止驻留的 watch(取消槽),无未处理 rejection', async () => {
    remote.enqueue(okResult(snapshot()))
    controller.ensure()
    await tick()
    await tick()
    expect(remote.watchCalls).toBe(1)
    controller.dispose()
    await tick()
    await tick()
    // 驻留已中止;不再有新调用。
    expect(remote.watchCalls).toBe(1)
  })
})
