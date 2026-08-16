/**
 * Per-session Git view controller (React-free object layer).
 * Lifecycle: `ensure()` on first mount, single-flight `refresh()`, polling at
 * the interval the host snapshot carries (0 disables), `resync()` on
 * connection reset, `dispose()` on slot teardown (clears the timer and
 * rejects nothing — in-flight work settles into a withdrawn view).
 */
import type { GitSnapshot, GitSnapshotFailure, GitSnapshotRequest, GitSnapshotResult } from '../host/types.ts'

/** The observable view contract components consume (useSyncExternalStore shape). */
export interface GitObservable<V> {
  subscribe(listener: () => void): () => void
  getSnapshot(): V
}

export type GitView =
  | { readonly state: 'no-cwd' }
  | { readonly state: 'cold' }
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly snapshot: GitSnapshot }
  | { readonly state: 'error'; readonly error: GitSnapshotFailure }

/**
 * RPC envelope returned by every mounted Remote method (see the api-gateway
 * client's `invoke`): `ok` reflects the transport/gateway outcome, and the
 * business return value of the host method rides inside `value`. For
 * `gitInfo/snapshot` that business value is a `GitSnapshotResult` — so a
 * successful call resolves to `{ ok: true, value: { ok: true, value:
 * GitSnapshot } }`.
 */
export type GitRemoteEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string; readonly details?: unknown } }

/** Structural face of the mounted gitInfo Remote namespace. */
export interface GitRemoteLike {
  snapshot(request: GitSnapshotRequest): Promise<GitRemoteEnvelope<GitSnapshotResult>>
}

/** Failure codes that mean "no working directory to watch" — degrade to a
 * low-frequency probe instead of a normal poll. */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['cwd-unavailable', 'session-not-found'])

/** Fallback poll interval while no snapshot has been received yet (ms). */
const DEFAULT_POLL_MS = 30_000

/** Probe interval for the no-cwd state: the session may gain a working
 * directory later (workspace selection, host-side session update) without a
 * slot remount, so keep a cheap retry instead of parking forever. */
const NO_CWD_POLL_MS = 60_000

export class GitController implements GitObservable<GitView> {
  private view: GitView = { state: 'cold' }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  private disposed = false
  private pollMs: number = DEFAULT_POLL_MS

  constructor(
    private readonly remote: GitRemoteLike,
    private readonly sessionId: string,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): GitView {
    return this.view
  }

  /** Load once on first mount (cold) or after a terminal no-cwd state. */
  ensure(): void {
    if (this.view.state !== 'cold' && this.view.state !== 'no-cwd') return
    void this.refresh()
  }

  /** Single-flight refresh; shares the in-flight request when busy. */
  refresh(): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    if (this.disposed) return Promise.resolve()
    this.setView({ state: 'loading' })
    this.inflight = this.remote.snapshot({ sessionId: this.sessionId })
      .then((result) => {
        if (this.disposed) return
        // RPC envelope: `result.ok` is the transport/gateway outcome; the
        // business GitSnapshotResult (ok/value or ok/error) sits in
        // `result.value`.
        if (!result.ok) {
          const detail = [result.error.code, result.error.message].filter(Boolean).join(': ')
          this.setView({ state: 'error', error: { code: 'git-unavailable', detail: detail || 'rpc failure' } })
          return
        }
        const inner = result.value
        if (inner.ok) {
          this.pollMs = inner.value.refreshIntervalMs
          this.setView({ state: 'ready', snapshot: inner.value })
        } else if (TERMINAL_CODES.has(inner.error.code)) {
          // Terminal no-cwd view: the finally-branch schedules the low-
          // frequency probe (schedulePoll), so no explicit stop here.
          this.setView({ state: 'no-cwd' })
        } else {
          this.setView({ state: 'error', error: inner.error })
        }
      })
      .catch(() => {
        // Transport failure: surface an error view and keep polling so the
        // state recovers automatically.
        if (this.disposed) return
        this.setView({ state: 'error', error: { code: 'git-unavailable', detail: 'transport failure' } })
      })
      .finally(() => {
        this.inflight = undefined
        if (!this.disposed) this.schedulePoll()
      })
    return this.inflight
  }

  /** Re-sync after a connection reset (reconnect). */
  resync(): void {
    // no-cwd is skipped: the low-frequency probe already covers recovery,
    // and a reconnect alone does not create a working directory.
    if (this.disposed || this.view.state === 'cold' || this.view.state === 'no-cwd') return
    void this.refresh()
  }

  /** Tear down: stop the timer; in-flight work settles into a no-op. */
  dispose(): void {
    this.disposed = true
    this.stopPolling()
  }

  private schedulePoll(): void {
    this.stopPolling()
    if (this.disposed || this.pollMs <= 0 || this.view.state === 'cold') return
    // no-cwd keeps a low-frequency probe so a later cwd arrival recovers
    // without a remount; every other state polls at the snapshot interval.
    const interval = this.view.state === 'no-cwd' ? NO_CWD_POLL_MS : this.pollMs
    this.timer = setTimeout(() => {
      if (this.disposed || this.inflight !== undefined) return
      void this.refresh()
    }, interval)
  }

  private stopPolling(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private setView(view: GitView): void {
    this.view = view
    for (const listener of [...this.listeners]) listener()
  }
}
