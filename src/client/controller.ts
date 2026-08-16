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

/** Structural face of the mounted gitInfo Remote namespace. */
export interface GitRemoteLike {
  snapshot(request: GitSnapshotRequest): Promise<GitSnapshotResult>
}

/** Failure codes that mean "no working directory to watch" — stop polling. */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['cwd-unavailable', 'session-not-found'])

/** Fallback poll interval while no snapshot has been received yet (ms). */
const DEFAULT_POLL_MS = 30_000

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
        if (result.ok) {
          this.pollMs = result.value.refreshIntervalMs
          this.setView({ state: 'ready', snapshot: result.value })
        } else if (TERMINAL_CODES.has(result.error.code)) {
          this.stopPolling()
          this.setView({ state: 'no-cwd' })
        } else {
          this.setView({ state: 'error', error: result.error })
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
    if (this.disposed || this.pollMs <= 0 || this.view.state === 'no-cwd' || this.view.state === 'cold') return
    this.timer = setTimeout(() => {
      if (this.disposed || this.inflight !== undefined) return
      void this.refresh()
    }, this.pollMs)
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
