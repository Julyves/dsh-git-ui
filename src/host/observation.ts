/**
 * 工作区变更观测时间线(每会话一份,宿主内存持有,可持久化)。
 *
 * 纯业务层:零框架依赖、无 I/O;持久化与 git 对账经注入面完成
 * (`ObservationPersistence` / 调用方传入的 git 能力)。
 *
 * 语义:
 *   - `update(changes, now)` 每轮 snapshot 后调用:新路径 → firstSeenAt=now;
 *     仍在 → 刷新 status、lastSeenAt 置 null;消失 → lastSeenAt=now;
 *   - `markCommitted(paths, now)` HEAD 移动检测时调用(提交使路径离开工作区,
 *     但记录语义要求条目保留并标注已提交);
 *   - 容量上限:超限按 firstSeenAt 裁剪最旧(旧 turn 记录失去外部条目,
 *     internal 仍由会话日志保证——可接受的欠计,文档化)。
 */

import type { GitChange, GitChangeStatus } from './types.ts'

/** 单条路径观测。 */
export interface PathObservation {
  readonly path: string
  readonly status: GitChangeStatus
  /** 轮询首见时刻(Unix ms)。 */
  readonly firstSeenAt: number
  /** 离开工作区时刻;null = 仍在。 */
  readonly lastSeenAt: number | null
  /** HEAD 移动检测到的提交时刻;null = 未观测到提交。 */
  readonly committedAt: number | null
}

/** 观测持久化通道(宿主实现为插件数据存储 obs-<key>.jsonl;测试用内存桩)。 */
export interface ObservationPersistence {
  read(): Promise<string | null>
  write(raw: string): Promise<void>
}

/** 恢复路径合法性:相对、单段无逃逸(拒绝前导 /、反斜杠、`..` 段)。 */
function isSafeObservationPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false
  for (const segment of path.split('/')) {
    if (segment === '..' || segment === '.') return false
  }
  return true
}

/** 每会话观测容量上限(超限裁剪最旧)。 */
export const OBSERVATION_CAP = 2000

export class ObservationLog {
  private readonly map = new Map<string, PathObservation>()
  /** 读快照(只读视图)。 */
  entries(): readonly PathObservation[] {
    return [...this.map.values()]
  }

  get(path: string): PathObservation | undefined {
    return this.map.get(path)
  }

  /**
   * 每轮 snapshot 后更新。`changes` 为当前 git 变更列表,
   * `unwindNow` 用于本轮变更列表被截断(truncated)时避免误判消失。
   */
  /** 变更是否为空(首个快照触发但未曾变化)。 *新增返回:观测集合是否有实际变化(供调用方决定是否落盘)。*/
  update(changes: readonly GitChange[], now: number, truncated = false): boolean {
    let changed = false
    const present = new Set<string>()
    for (const change of changes) {
      present.add(change.path)
      const existing = this.map.get(change.path)
      if (existing === undefined) {
        this.map.set(change.path, {
          path: change.path,
          status: change.status,
          firstSeenAt: now,
          lastSeenAt: null,
          committedAt: null,
        })
        changed = true
      } else if (existing.status !== change.status) {
        this.map.set(change.path, { ...existing, status: change.status, lastSeenAt: null })
        changed = true
      } else {
        // 无状态变化:lastSeenAt 保持 null(仍在场)即可,不触发落盘。
        if (existing.lastSeenAt !== null) {
          this.map.set(change.path, { ...existing, lastSeenAt: null })
          changed = true
        }
      }
    }
    if (truncated) return changed // 截断时不判定消失
    for (const [path, observation] of this.map) {
      if (!present.has(path) && observation.lastSeenAt === null) {
        this.map.set(path, { ...observation, lastSeenAt: now })
        changed = true
      }
    }
    this.prune()
    return changed
  }

  /** HEAD 前移检测到提交:对应路径标注 committedAt(未观测的路径忽略)。 */
  markCommitted(paths: readonly string[], now: number): void {
    for (const path of paths) {
      const observation = this.map.get(path)
      if (observation !== undefined && observation.committedAt === null) {
        this.map.set(path, { ...observation, committedAt: now })
      }
    }
  }

  /**
   * 以持久化条目恢复。**合并语义**:本会话运行期间(读盘前)已观测到的
   * 条目优先级更高(更新鲜),磁盘条目只补缺口——避免 ensure→restore
   * 异步窗口内 observe 的数据被清空(竞态)。
   */
  restore(entries: readonly PathObservation[]): void {
    for (const entry of entries) {
      if (isSafeObservationPath(entry.path) && !this.map.has(entry.path)) {
        this.map.set(entry.path, entry)
      }
    }
    this.prune()
  }

  /** 序列化(供持久化;紧凑 JSONL 的编解码在 obs-file.ts)。 */
  serialize(): readonly PathObservation[] {
    this.prune()
    return this.entries()
  }

  private prune(): void {
    if (this.map.size <= OBSERVATION_CAP) return
    const sorted = [...this.map.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    const cutoff = sorted[this.map.size - OBSERVATION_CAP]?.firstSeenAt ?? Infinity
    for (const [path, observation] of this.map) {
      if (observation.firstSeenAt < cutoff) this.map.delete(path)
    }
    // 仍超限(同刻首见大量条目):按进入顺序硬截断。
    let excess = this.map.size - OBSERVATION_CAP
    if (excess > 0) {
      for (const [path] of this.map) {
        if (excess <= 0) break
        this.map.delete(path)
        excess -= 1
      }
    }
  }
}