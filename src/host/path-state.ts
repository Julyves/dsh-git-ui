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
 *         后续提交推翻,故新提交命中时(`markCommitted`)覆盖为 committed;
 *       * 未判定 → 组装层显示中性态 `gone`(已离开工作区,去向待定)。
 *   - **配额护栏**(吸取"命令风暴"事故教训 R1/R5):每查询轮最多探测
 *     `UPGRADE_BUDGET_PER_QUERY` 条,`tryAcquire` 防同轮重复,渐进收敛,
 *     不做一次性命令风暴。
 *
 * 缓存不落盘:宿主重启后重新逐轮收敛(每轮 25 条,按查询推进)。
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

/** 每查询轮的探测配额(条):25 × ~10ms 顺序 ≈ 250ms,渐进收敛的代价上限。 */
export const UPGRADE_BUDGET_PER_QUERY = 25

/** 判定缓存容量上限(committed/reverted 各自);超出按 FIFO 裁剪(防无限增长)。 */
export const PATH_STATE_CAP = 5000

/**
 * 每会话一分的去向判定缓存。
 * 同步 API 供组装层查询;探测循环由编排层驱动(tryAcquire 领取配额)。
 */
export class PathStateTracker implements PathStateLookup {
  private readonly committed = new Set<string>()
  private readonly reverted = new Set<string>()
  /** 本轮已尝试探测的路径(防同轮重复领取/重复等待)。 */
  private readonly attempted = new Set<string>()
  private budget = 0

  get(path: string): PathFinalState | undefined {
    if (this.committed.has(path)) return 'committed'
    if (this.reverted.has(path)) return 'reverted'
    return undefined
  }

  /** 写入权威判定结果;committed 覆盖既有 reverted(提交是最终事实)。 */
  set(path: string, state: PathFinalState): void {
    if (state === 'committed') {
      this.reverted.delete(path)
      this.committed.add(path)
      this.trim(this.committed, PATH_STATE_CAP)
    } else {
      if (this.committed.has(path)) return // 已提交的事实不被 reverted 覆盖
      this.reverted.add(path)
      this.trim(this.reverted, PATH_STATE_CAP)
    }
  }

  /** 每查询轮开始:重置配额与已尝试集合(缓存未命中者新轮可重新探测)。 */
  beginCycle(): void {
    this.budget = UPGRADE_BUDGET_PER_QUERY
    this.attempted.clear()
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