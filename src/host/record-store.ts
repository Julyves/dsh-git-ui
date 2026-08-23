/**
 * Turn 工作记录的 per-session 编排状态机(纯业务层,零框架依赖)。
 *
 * 职责:持有每个会话的 TurnLog + ObservationLog,驱动增量折叠、
 * 观测更新、记录组装与观测持久化(去抖落盘 / 恢复对账),并把
 * 对账所需的 git 探针与持久化通道作为注入面暴露给适配层。
 *
 * 时序约定(调用方):
 *   1. `ensure(sessionId, probe)` 首次访问:建态并**后台**恢复观测
 *      (读文件 + 对账)。恢复不阻塞组装——internal 由会话日志保证,
 *      external 在恢复完成前暂缺,落定后自然补齐;
 *   2. `fold(sessionId, events, fromSeq)` 每个新事件批次(增量);
 *   3. `observe(sessionId, changes, now, truncated)` 每轮 snapshot 后;
 *   4. `headAdvanced(sessionId, commitPaths, now)` HEAD 前移时;
 *   5. `assemble(sessionId, deps)` 产出对外记录;
 *   6. `flush(sessionId)` / `flushAll()` / `disposeSession(sessionId)`。
 */

import { ObservationLog, type ObservationPersistence } from './observation.ts'
import { decodeObservations, encodeObservations } from './obs-file.ts'
import { TurnLog, type FoldedTurn } from './turns.ts'
import { assembleAll, type AssembleDeps, type TurnWorkRecord } from './record-assembly.ts'

/** 观测落盘去抖窗口(ms):连续轮询合并为一次写盘。 */
export const OBS_FLUSH_DEBOUNCE_MS = 5000

/** 恢复对账的单会话探针路径上限(超出部分按 reverted 处理)。 */
export const RECONCILE_PROBE_CAP = 50

/** 恢复对账探针:某路径是否出现于新提交(host 用 git log 实现)。 */
export interface CommitProbe {
  isCommitted(path: string): Promise<boolean>
}

/** 单会话内部状态。 */
interface SessionState {
  readonly log: TurnLog
  readonly observations: ObservationLog
  dirty: boolean
  lastHead: string | null | undefined
}

/** 观测持久化通道工厂(host 按 sessionId 封装插件数据存储)。 */
export type PersistenceFactory = (sessionId: string) => ObservationPersistence

export class RecordStore {
  private readonly states = new Map<string, SessionState>()
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly persistenceFor: PersistenceFactory,
    private readonly flushDebounceMs: number = OBS_FLUSH_DEBOUNCE_MS,
  ) {}

  /** 会话状态是否存在(会话列表/测试用)。 */
  has(sessionId: string): boolean {
    return this.states.has(sessionId)
  }

  /** 懒建会话状态并触发后台恢复(幂等)。 */
  ensure(sessionId: string, probe: CommitProbe): void {
    const state = this.states.get(sessionId)
    if (state !== undefined) return
    const created = this.newState()
    this.states.set(sessionId, created)
    void this.restore(sessionId, created, probe).catch(() => {
      // 恢复失败(读损坏/IO):静默保持内存默认态——观测从零开始,不崩溃。
      created.dirty = false
    })
  }

  /** 事件折叠(增量;fromSeq 用于子会话 seed 边界)。 */
  fold(sessionId: string, events: Parameters<TurnLog['append']>[0], fromSeq = 0): void {
    this.require(sessionId).log.append(events, fromSeq)
  }

  /** 观测更新(snapshot 后)。仅在观测实际变化时安排落盘(避免写放大)。 */
  observe(sessionId: string, changes: readonly (import('./types.ts').GitChange)[], now: number, truncated = false): void {
    const state = this.require(sessionId)
    const changed = state.observations.update(changes, now, truncated)
    if (changed) this.scheduleFlush(sessionId, state)
  }

  /** HEAD 前移:提交路径标注 committedAt。 */
  headAdvanced(sessionId: string, commitPaths: readonly string[], now: number): void {
    const state = this.require(sessionId)
    state.observations.markCommitted(commitPaths, now)
    this.scheduleFlush(sessionId, state)
  }

  /**
   * 记录 HEAD 并检测前移:前移时经 resolveCommits(old, new) 取提交路径
   * (调用方执行 git log;失败返回 [] 即可,不抛)。未出生(null)与未变化
   * 均不触发。幂等:重复调用同 head 无操作。
   */
  async noteHead(
    sessionId: string,
    head: string | null,
    now: number,
    resolveCommits: (from: string, to: string) => Promise<readonly string[]> | readonly string[],
  ): Promise<void> {
    const state = this.require(sessionId)
    const previous = state.lastHead
    state.lastHead = head
    if (head === null || previous === undefined || previous === null || previous === head) return
    let commits: readonly string[]
    try {
      commits = await resolveCommits(previous, head)
    } catch {
      return
    }
    if (commits.length === 0) return
    state.observations.markCommitted(commits, now)
    this.scheduleFlush(sessionId, state)
  }

  /** 会话折叠后的 turn 列表(组装/子会话归并用)。 */
  turns(sessionId: string): readonly FoldedTurn[] {
    return this.require(sessionId).log.turns
  }

  /** 组装对外记录。 */
  assemble(sessionId: string, deps: Omit<AssembleDeps, 'log' | 'observations'>): readonly TurnWorkRecord[] {
    const state = this.require(sessionId)
    return assembleAll({ log: state.log, observations: state.observations, ...deps })
  }

  /** 立即冲刷一个会话的观测落盘。 */
  flush(sessionId: string): void {
    const state = this.require(sessionId)
    this.cancelFlush(sessionId)
    void this.persist(sessionId, state)
  }

  /** 冲刷全部会话(宿主 dispose 时)。 */
  flushAll(): void {
    for (const [sessionId, state] of this.states) {
      void this.persist(sessionId, state)
    }
  }

  /** 会话离开内存:冲刷并释放状态。 */
  disposeSession(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state === undefined) return
    this.cancelFlush(sessionId)
    void this.persist(sessionId, state)
    this.states.delete(sessionId)
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private newState(): SessionState {
    return {
      log: new TurnLog(),
      observations: new ObservationLog(),
      dirty: false,
      lastHead: undefined,
    }
  }

  private require(sessionId: string): SessionState {
    const state = this.states.get(sessionId)
    if (state === undefined) {
      // 未 ensure 的调用(如纯查询路径):建空态,无持久化钩子。
      const created = this.newState()
      this.states.set(sessionId, created)
      return created
    }
    return state
  }

  private async restore(sessionId: string, state: SessionState, probe: CommitProbe): Promise<void> {
    const raw = await this.persistenceFor(sessionId).read()
    const entries = raw === null ? [] : (decodeObservations(raw) ?? [])
    state.observations.restore(entries)
    // 对账:消失且未标提交的条目 → 探针判定 committed/reverted。
    const candidates = entries
      .filter((entry) => entry.committedAt === null)
      .slice(0, RECONCILE_PROBE_CAP)
    const committed: string[] = []
    for (const entry of candidates) {
      try {
        if (await probe.isCommitted(entry.path)) committed.push(entry.path)
      } catch {
        // 探针失败(仓库不可用等):该条目保持 reverted,不阻塞恢复。
      }
    }
    if (committed.length > 0) state.observations.markCommitted(committed, Date.now())
    state.dirty = true
  }

  private scheduleFlush(sessionId: string, state: SessionState): void {
    state.dirty = true
    this.cancelFlush(sessionId)
    const timer = setTimeout(() => {
      this.flushTimers.delete(sessionId)
      void this.persist(sessionId, state)
    }, this.flushDebounceMs)
    this.flushTimers.set(sessionId, timer)
  }

  private cancelFlush(sessionId: string): void {
    const timer = this.flushTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.flushTimers.delete(sessionId)
    }
  }

  private async persist(sessionId: string, state: SessionState): Promise<void> {
    if (!state.dirty) return
    const encoded = encodeObservations(state.observations.serialize())
    state.dirty = false
    try {
      await this.persistenceFor(sessionId).write(encoded)
    } catch {
      // 写失败(IO/超限):内存态保留,标记 dirty 供下次补写;不崩溃。
      state.dirty = true
    }
  }
}