/**
 * Per-session Git view controller (React-free object layer).
 * Lifecycle: `ensure()` on first mount, single-flight `refresh()`, polling at
 * the interval the host snapshot carries (0 disables), `resync()` on
 * connection reset, `dispose()` on slot teardown (clears the timer and
 * rejects nothing — in-flight work settles into a withdrawn view).
 */
import type { GitActionResult, GitActionRequest, GitQueryRequest } from '../host/types.ts'
import type { GitObservable, GitView, GitRemoteLike, GitQueryOutcome } from '../contracts/client-platform.ts'

// Re-export for backward compatibility — 其他模块仍可从 controller 导入这些类型
export type { GitObservable, GitView, GitRemoteLike, GitQueryOutcome } from '../contracts/client-platform.ts'
export type { RemoteEnvelope as GitRemoteEnvelope } from '../contracts/client-platform.ts'

/** Failure codes that mean "no working directory to watch" — degrade to a
 * low-frequency probe instead of a normal poll. */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['cwd-unavailable', 'session-not-found'])

/** Fallback poll interval while no snapshot has been received yet (ms). */
const DEFAULT_POLL_MS = 30_000

/** Probe interval for the no-cwd state: the session may gain a working
 * directory later (workspace selection, host-side session update) without a
 * slot remount, so keep a cheap retry instead of parking forever. */
const NO_CWD_POLL_MS = 60_000

// ── watch 长轮询(事件驱动刷新)常量 ─────────────────────────────────────────

/** watch 请求的等待时长(ms);宿主 clamp 至 60s。心跳不跑 git,只维持链路。 */
const WATCH_WAIT_MS = 25_000
/** watch 失败后的重试间歇(ms):防错误风暴(重连窗口内通常 1-2 次即恢复)。 */
const WATCH_RETRY_MS = 3_000
/** 连续失败此数后放弃 watch,退化纯轮询(功能探测降级;重挂载即重试)。 */
const WATCH_MAX_FAILURES = 5
/** watch 健康时安全兜底轮询放大倍数(30s→120s):事件驱动为主,慢速自愈
 * 漏事件(watcher 降级/网络盘/内核队列溢出);失败或未启用 = 标准档。 */
const WATCH_SAFETY_FACTOR = 4
/** 变更刷新后的静默间歇(ms):「突发写→静默 300ms」节律(构建产物等)
 * 下若无间歇,每防抖窗一轮全量快照;间歇把上限定为约 1 轮/秒,代价是
 * 连续变更中后续变更的感知延迟 ≤ 本值。 */
const WATCH_SETTLE_MS = 1_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

export class GitController implements GitObservable<GitView> {
  private view: GitView = { state: 'cold' }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  private disposed = false
  private pollMs: number = DEFAULT_POLL_MS

  // ── watch 长轮询状态(独立放环;绝不占用 inflight single-flight 槽) ──────
  /** 最近一次快照携带的仓库监听版本(undefined = 宿主无 watch 能力,
   *  升降级混布保护——不启用循环,纯轮询)。 */
  private watchVersion: number | undefined
  private watchRunning = false
  /** 至少一次 watch 成功往返(安全兜底轮询拉长的前提)。 */
  private watchHealthy = false
  private watchFailures = 0
  private watchAbort: AbortController | undefined

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

  /** Single-flight refresh; shares the in-flight request when busy.
   * 排队用 then-重试而非直接共享 promise:旧请求已结算而 finally 清理
   * 尚未执行的微任务窗口里,直接返回旧 promise 会把调用静默吞掉——
   * 事件驱动(watch changed)的刷新必须真正发起,否则变更丢失。 */
  refresh(): Promise<void> {
    if (this.inflight !== undefined) return this.inflight.then(() => this.refresh())
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

  /**
   * Run one management action. On success the host returns a fresh snapshot
   * which becomes the view immediately (no waiting for the next poll); the
   * returned result lets the caller show operation feedback. Shares the
   * single-flight slot with refresh, so an action never overlaps a poll.
   */
  run(action: GitActionRequest['action']): Promise<GitActionResult> {
    if (this.inflight !== undefined) return this.inflight.then(() => this.run(action))
    if (this.disposed) return Promise.resolve({ ok: false, error: { code: 'git-error', message: 'controller disposed' } })
    // Deliberately no loading view here: an operation must not blank the
    // pill/panel while it runs — the UI shows its own busy state, and a
    // failure keeps the current view for context.
    const promise = this.remote.run({ sessionId: this.sessionId, action })
      .then((result) => {
        if (this.disposed) return { ok: false, error: { code: 'git-error', message: 'controller disposed' } } as GitActionResult
        if (!result.ok) {
          const detail = [result.error.code, result.error.message].filter(Boolean).join(': ')
          this.setView({ state: 'error', error: { code: 'git-unavailable', detail: detail || 'rpc failure' } })
          return { ok: false, error: { code: 'git-error', message: detail || 'rpc failure' } } as GitActionResult
        }
        const inner = result.value
        if (inner.ok) {
          this.pollMs = inner.snapshot.refreshIntervalMs
          this.setView({ state: 'ready', snapshot: inner.snapshot })
        } else if (TERMINAL_CODES.has(inner.error.code)) {
          this.setView({ state: 'no-cwd' })
        }
        // Other failures keep the current view (context for the panel); the
        // error rides back to the caller for display.
        return inner
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!this.disposed) {
          this.setView({ state: 'error', error: { code: 'git-unavailable', detail: 'transport failure' } })
        }
        return { ok: false, error: { code: 'git-error', message } } as GitActionResult
      })
      .finally(() => {
        this.inflight = undefined
        if (!this.disposed) this.schedulePoll()
      })
    this.inflight = promise.then(() => undefined)
    return promise
  }

  /**
   * Run one read-only query (history / diff / show / branches). The view is
   * untouched — the result goes straight back to the caller. Queues behind
   * any in-flight refresh/run like everything else (single-flight).
   */
  query(query: GitQueryRequest['query']): Promise<GitQueryOutcome> {
    if (this.inflight !== undefined) return this.inflight.then(() => this.query(query))
    if (this.disposed) return Promise.resolve({ ok: false, message: 'controller disposed' })
    const promise = this.remote.query({ sessionId: this.sessionId, query })
      .then((result): GitQueryOutcome => {
        if (!result.ok) {
          const detail = [result.error.code, result.error.message].filter(Boolean).join(': ')
          return { ok: false, message: detail || 'rpc failure' }
        }
        const inner = result.value
        if (inner.ok) return { ok: true, value: inner.value }
        return { ok: false, message: inner.error.message ?? inner.error.code }
      })
      .catch((error: unknown): GitQueryOutcome => {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      })
      .finally(() => {
        this.inflight = undefined
        if (!this.disposed) this.schedulePoll()
      })
    this.inflight = promise.then(() => undefined)
    return promise
  }

  /** 卸载:停轮询计时器;中止驻留的 watch 长轮询(取消信号直达宿主,
   * 引用即时释放);在途请求按各自承诺结算为空操作。 */
  dispose(): void {
    this.disposed = true
    // 中止驻留的 watch 长轮询:取消槽直达宿主,引用即时释放。
    this.watchAbort?.abort()
    this.watchAbort = undefined
    this.stopPolling()
  }

  // ── watch 长轮询循环 ──────────────────────────────────────────────────────

  /**
   * ready 视图到达后启动 watch 循环(幂等):宿主支持(watchVersion 存在)
   * 且未降级时,以长轮询取代定时轮询的主力地位。连续失败达到上限为
   * **终态**(重挂载即重试)——不得反复重启探测风暴,也不得在降级退出时
   * 重置正常轮询节拍之外再引入额外排程。
   */
  private startWatchLoop(): void {
    if (this.disposed || this.watchRunning) return
    if (this.watchVersion === undefined) return
    if (this.watchFailures >= WATCH_MAX_FAILURES) return
    this.watchRunning = true
    void this.runWatchLoop()
  }

  /**
   * 事件驱动刷新主循环:挂起 watch RPC → 变更即刷新 → 重挂;超时未变 →
   * 原样重挂(心跳零 git spawn);失败 → 计数退避 → 连续 WATCH_MAX_FAILURES
   * 次后放弃,安全兜底轮询回到标准间隔(最坏行为 = 纯轮询现状)。
   *
   * 关键约束:循环**直接调用 remote**(不走 this.query/refresh 的互斥槽),
   * 驻留期间 refresh/run/query 照常通行;仅 changed 分支调用 refresh()
   * (此时才按普通刷新占用 single-flight,与轮询同路径)。
   */
  private async runWatchLoop(): Promise<void> {
    const wasHealthy = this.watchHealthy
    while (!this.disposed && this.watchFailures < WATCH_MAX_FAILURES) {
      const abort = new AbortController()
      this.watchAbort = abort
      let retryDelay = 0
      try {
        // RPC 双层信封:外层 transport(result.ok),内层业务(result.value.ok)。
        const result = await this.remote.query(
          { sessionId: this.sessionId, query: { kind: 'watch', version: this.watchVersion ?? 0, waitMs: WATCH_WAIT_MS } },
          abort.signal,
        )
        if (this.disposed) return
        if (result.ok && result.value.ok && result.value.value.kind === 'watch') {
          const watch = result.value.value
          this.watchHealthy = true
          if (watch.changed) {
            // 有变更:立即全量刷新(普通 single-flight 路径);快照带回
            // 新 watchVersion,setView ready 后继续下一轮挂起。
            await this.refresh()
            // 仓库消失(no-cwd,复审 P2-1):no-cwd 低频探测已接管恢复,
            // watch 循环退出(该分支不是失败也不是健康往返,不动计数);
            // 会话恢复/重挂后的 ready 视图会重启循环。
            if (this.view.state === 'no-cwd') {
              this.watchRunning = false
              // 复审增量 P2-a:pollMs=0 时 schedulePoll 对 no-cwd 分支
              // 早退,60s 恢复探测不会排程——回退默认档,保证恢复通道。
              if (this.pollMs <= 0) {
                this.pollMs = DEFAULT_POLL_MS
                this.schedulePoll()
              }
              return
            }
            if (this.view.state === 'error') {
              // 复审 R1:refresh 持续失败(error 视图)时锚点无法前进——
              // 「宿主重启版本归零 + git 暂不可用」的组合会让 changed 紧
              // 循环。失败计入降级计数并【就地退避】(链A P1-1:退避必须
              // 真实生效;分支间互斥结算,不得落入下方业务错误分支二次
              // 计数)。清零仅属于完整健康往返(changed 且刷新成功)。
              this.watchFailures += 1
              await sleep(WATCH_RETRY_MS)
              continue
            }
            // 完整健康往返:清零 + 刷新节流间歇(复审 S2)。
            this.watchFailures = 0
            await sleep(WATCH_SETTLE_MS)
            continue
          }
          // 超时未变:链路健康,清零后原样重挂(retryDelay=0,底部不等待)。
          this.watchFailures = 0
          continue
        }
        // 业务错误(watcher 关闭/无 root 等)——降级计数,底部统一退避。
        this.watchFailures += 1
        retryDelay = WATCH_RETRY_MS
      } catch {
        if (this.disposed) return
        this.watchFailures += 1
        retryDelay = WATCH_RETRY_MS
      } finally {
        if (this.watchAbort === abort) this.watchAbort = undefined
      }
      if (retryDelay > 0 && !this.disposed && this.watchFailures < WATCH_MAX_FAILURES) {
        await sleep(retryDelay)
      }
    }
    this.watchRunning = false
    // 降级:健康标记清零(此后所有 schedulePoll 走标准档)。仅当曾经
    // 健康(兜底轮询被拉长过)才立即重排一次回落节拍;从未健康则轮询
    // 一直是标准档,无需也不得重置既有排程。
    this.watchHealthy = false
    if (!this.disposed) {
      if (this.pollMs <= 0) {
        // 复审 P2-5:「事件驱动 only」配置(轮询关闭)遇 watch 降级 →
        // 回退默认探测档——避免无任何自愈通道的冻结视图。
        this.pollMs = DEFAULT_POLL_MS
        this.schedulePoll()
      } else if (wasHealthy) {
        this.schedulePoll()
      }
    }
  }

  private schedulePoll(): void {
    this.stopPolling()
    if (this.disposed || this.pollMs <= 0 || this.view.state === 'cold') return
    // no-cwd keeps a low-frequency probe so a later cwd arrival recovers
    // without a remount; every other state polls at the snapshot interval.
    // 复审 R9:no-cwd 探测不乘安全倍数——那是 watch 健康时给「事件驱动
    // 为主」的兜底放慢;no-cwd 是恢复探测,放慢 4× 会拖迟仓库回归感知。
    const interval = this.view.state === 'no-cwd'
      ? NO_CWD_POLL_MS
      : this.watchHealthy
        ? this.pollMs * WATCH_SAFETY_FACTOR
        : this.pollMs
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
    if (view.state === 'ready') {
      // ready 快照携带 watchVersion:同步锚点并(重)启动 watch 循环。
      // undefined(旧宿主快照)不覆盖既有锚点——锚点一旦建立即保留:若
      // 后续快照缺失该字段(降级部署),循环会以陈旧锚点探测旧宿主,
      // 连续失败后终态降级(重挂载才会重试);安全且有界。
      const next = view.snapshot.watchVersion
      if (next !== undefined) this.watchVersion = next
      this.startWatchLoop()
    }
    for (const listener of [...this.listeners]) listener()
  }
}
