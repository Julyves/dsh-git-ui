/**
 * 工作记录增量未读(纯客户端,无 RPC)。
 *
 * pill 的未读信号回答「要不要关心」而非「总量多少」:徽章显示自上次
 * 查看以来新出现的条目数(全 turn、全作者组),查看(打开弹窗或记录页)
 * 即清零回到总量徽章。已读时刻为**易失 UI 状态**,存 localStorage
 * (按会话隔离)——不进设置契约(非用户偏好)、不占 host 磁盘配额。
 */

import type { TurnWorkRecord } from '../../host/types.ts'

/** localStorage 键前缀(易失 UI 态;与 v1 设置遗留键不同族)。 */
const SEEN_KEY_PREFIX = 'dsh-git-ui:seen:'

/** 读取会话的上次查看时刻;从未查看 → 0(全部视为未读)。读写均容错
 * (隐私模式/配额/SSR 下 localStorage 可能抛出——降级为 0,仅退化为全量徽章)。 */
export function readSeenAt(sessionId: string): number {
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_KEY_PREFIX + sessionId)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

/** 标记已读(写入当前时刻);返回该时刻供调用方更新组件状态。 */
export function markSeen(sessionId: string, now: number = Date.now()): number {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY_PREFIX + sessionId, String(now))
  } catch {
    // 写失败:内存态已读语义仍成立(调用方拿返回值更新 state)。
  }
  return now
}

/** 自 seenAt 以来新出现的**路径**数(全 turn、三作者组并计)。
 * 不可按 turn.startAt 剪枝:跨越已读时刻的长 turn 内仍可能有新条目。
 * 同一路径可出现在多个 turn 记录中(host 归因是 per-turn 的)——按路径
 * 取最大 firstSeenAt 后计数,未读口径与时段视图的去重口径一致(BUG-R1)。 */
export function countUnseen(records: readonly TurnWorkRecord[] | null, seenAt: number): number {
  if (records === null || seenAt <= 0) return 0
  const latestByPath = new Map<string, number>()
  const consider = (entries: ReadonlyArray<{ readonly path: string; readonly firstSeenAt: number }>): void => {
    for (const entry of entries) {
      const known = latestByPath.get(entry.path)
      if (known === undefined || entry.firstSeenAt > known) latestByPath.set(entry.path, entry.firstSeenAt)
    }
  }
  for (const turn of records) {
    consider(turn.internal)
    consider(turn.sibling)
    consider(turn.external)
  }
  let unseen = 0
  for (const firstSeenAt of latestByPath.values()) {
    if (firstSeenAt > seenAt) unseen += 1
  }
  return unseen
}
