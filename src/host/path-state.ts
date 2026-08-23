/**
 * 路径最终去向的权威判定缓存与配额护栏(纯业务层,零框架依赖)。
 *
 * 背景:条目的三态判定里,"不在工作区且无提交证据"旧实现一律标 `reverted`,
 * 但大多数情况下文件只是已提交而提交发生在观测窗口之外(历史 turn / 宿主
 * 重启 / 页面关闭期间)——"已还原"是断言过度。本模块提供:
 *
 *   - `PathStateTracker`:每会话一份的判定缓存。
 *       * `committed` = 权威证据(HEAD 检测或 git log 探测)→ 永久事实;
 *       * `reverted` = 权威探测"从未进入当前 HEAD 可达历史" → 可能被
 *         后续提交推翻,故新提交命中时(组装层 HEAD 检测优先)显示为 committed;
 *       * 未判定 → 组装层显示中性态 `gone`(已离开工作区,去向待定)。
 *   - **配额护栏**(吸取"命令风暴"事故教训 R1/R5):每查询轮最多探测
 *     `UPGRADE_BUDGET_PER_QUERY` 条,`tryAcquire` 防同轮重复,渐进收敛。
 *   - **探测冷却**(事故复发教训:插件更新=宿主重启=缓存清空⇒全部 gone 条目
 *     重新逐轮 git log 探测,多会话叠加回到"命令风暴"量级):两次探测轮之间
 *     至少间隔 `PROBE_COOLDOWN_MS`,配合配额把收敛期峰值压到安全区。
 *   - **判定持久化**(根治):`restore`/`entries` 供宿主把判定缓存落盘/恢复,
 *     宿主重启后**不再重新收敛**——已判定事实(git 历史可达性)跨重启依然成立。
 *
 * 判定缓存每会话一份;已判定路径在记录查询中零命令(组装层直接命中)。
 */

/** 权威判定结果(区别于组装层的四态;仅两种确定去向)。 */
export type PathFinalState = 'committed' | 'reverted'

/** 组装层可读的判定缓存面(只读)。 */
export interface PathStateLookup {
  get(path: string): PathFinalState | undefined
}

/** 权威判定探针(git log -1 -- <path> 实现);失败返回 null = 保持待定。 */
export interface PathStateProbe {
  finalState(path: string): Promise<PathFinalState | null>
}

/** 每查询轮的探测配额(条):8 × ~10ms 顺序 ≈ 80ms,收敛期峰值的有界代价。 */
export const UPGRADE_BUDGET_PER_QUERY = 8

/** 两次探测轮之间的最小间隔(ms):把"重启后重建收敛"的每会话峰值
 * 从「每 30s 轮询 × 25 条」压到「每 60s 至多 8 条」。 */
export const PROBE_COOLDOWN_MS = 60_000

/** 判定缓存容量上限(committed/reverted 各自);超出按 FIFO 裁剪(防无限增长)。 */
export const PATH_STATE_CAP = 5000

/**
 * 每会话一分的去向判定缓存。
 * 同步 API 供组装层查询;探测循环由编排层驱动(tryAcquire 领取配额)。
 * 持久化:restore 载入(宿主重启后不复收敛)、entries 导出、set 产生的新判定
 * 置 dirty,由编排层在查询收敛后落盘。
 */
export class PathStateTracker implements PathStateLookup {
  private readonly committed = new Set<string>()
  private readonly reverted = new Set<string>()
  /** 本轮已尝试探测的路径(防同轮重复领取/重复等待)。 */
  private readonly attempted = new Set<string>()
  private budget = 0
  private lastProbeAt = -PROBE_COOLDOWN_MS
  /** 自上次持久化以来是否产生过新判定(变化判定的落盘依据)。 */
  private dirty = false
  /** 是否已完成一次磁盘恢复(编排层置位;恢复只做一次,幂等钩子)。 */
  restored = false

  get(path: string): PathFinalState | undefined {
    if (this.committed.has(path)) return 'committed'
    if (this.reverted.has(path)) return 'reverted'
    return undefined
  }

  /** 写入权威判定结果;committed 覆盖既有 reverted(提交是最终事实)。
   * 实际产生变化才置 dirty(无变化零写盘——R3 纪律)。 */
  set(path: string, state: PathFinalState): void {
    if (state === 'committed') {
      if (this.committed.has(path)) return
      this.reverted.delete(path)
      this.committed.add(path)
      this.trim(this.committed, PATH_STATE_CAP)
      this.dirty = true
    } else {
      if (this.committed.has(path)) return // 已提交的事实不被 reverted 覆盖
      if (this.reverted.has(path)) return
      this.reverted.add(path)
      this.trim(this.reverted, PATH_STATE_CAP)
      this.dirty = true
    }
  }

  /** 批量恢复持久化判定(宿主重启载入)。不触发 dirty——恢复不产生新判定。 */
  restore(entries: ReadonlyArray<readonly [string, PathFinalState]>): void {
    for (const [path, state] of entries) {
      if (state === 'committed') {
        if (!this.committed.has(path)) {
          this.reverted.delete(path)
          this.committed.add(path)
        }
      } else if (!this.committed.has(path)) {
        this.reverted.add(path)
      }
    }
    this.trim(this.committed, PATH_STATE_CAP)
    this.trim(this.reverted, PATH_STATE_CAP)
  }

  /** 全量导出(落盘用)。 */
  entries(): ReadonlyArray<readonly [string, PathFinalState]> {
    const out: Array<readonly [string, PathFinalState]> = []
    for (const path of this.committed) out.push([path, 'committed'])
    for (const path of this.reverted) out.push([path, 'reverted'])
    return out
  }

  /** 是否有未持久化的新判定。 */
  get isDirty(): boolean {
    return this.dirty
  }

  /** 落盘成功后复位(编排层调用)。 */
  clearDirty(): void {
    this.dirty = false
  }

  /**
   * 每查询轮开始:冷却期内返回 false(本轮不探测,配额归零);
   * 否则重置配额与已尝试集合(缓存未命中者新轮可重新探测)并返回 true。
   * 冷却时间戳由 `noteProbeCycle` 驱动——空轮(无 gone 条目)不启动冷却,
   * 只有真正领取过探测名额的轮次才让后续轮次进入冷却。
   */
  beginCycle(now: number): boolean {
    if (now - this.lastProbeAt < PROBE_COOLDOWN_MS) {
      this.budget = 0
      return false
    }
    this.budget = UPGRADE_BUDGET_PER_QUERY
    this.attempted.clear()
    return true
  }

  /** 记录一轮**实际**探测(至少领取过一个名额):启动后续冷却窗口。 */
  noteProbeCycle(now: number): void {
    this.lastProbeAt = now
  }

  /**
   * 领取一个探测名额:配额耗尽或同轮已尝试过 → false。
   * 调用方仅对"lookup 未命中"的路径调用。
   */
  tryAcquire(path: string): boolean {
    if (this.budget <= 0 || this.attempted.has(path)) return false
    this.attempted.add(path)
    this.budget -= 1
    return true
  }

  /** 当前轮已尝试的路径数(诊断/测试)。 */
  attemptedCount(): number {
    return this.attempted.size
  }

  /** 剩余配额(诊断/测试)。 */
  remainingBudget(): number {
    return this.budget
  }

  private trim(set: Set<string>, cap: number): void {
    if (set.size <= cap) return
    let excess = set.size - cap
    for (const value of set) {
      if (excess <= 0) break
      set.delete(value)
      excess -= 1
    }
  }
}