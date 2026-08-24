/**
 * subagent 子会话写路径适配:枚举子会话 + 折叠子日志 → 归入父 turn。
 *
 * dsh 事实(源码验证):子会话与父会话同库(header.meta.parentSession +
 * origin:'subagent');子日志以父日志为 seed(session/end-seed 边界)。
 * 子会话自己的工作 = 最后一个 session/end-seed 之后的事件 —— seed 部分
 * 是父会话自己的历史,父侧已折叠,子侧必须跳过(否则双重计数)。
 *
 * 归因:子会话的 tool/call 落在父某 turn 窗口 [startAt, endAt/∞] 内 →
 * 子写路径并入该父 turn 的 internal(父会话 agent 的委托工作)。
 *
 * 降级:冷子会话(live 之外)→ 跳过,文档化限制;`subagents` 服务缺失 →
 * 仅父会话 internal。
 */

import type { ToolPresenter, WritePathDetail } from '../../host/write-paths.ts'
import { extractWritePathDetails } from '../../host/write-paths.ts'
import { sliceEvents, type SessionLike } from './session-log.ts'

/** dsh sessions 服务切片(与本插件 host 注入的 'sessions' 一致)。 */
export interface SessionsLike {
  get(id: string): SessionLike | undefined
  list(): readonly { readonly id: string; readonly header?: { readonly cwd?: string; readonly meta?: Record<string, unknown> } }[]
}

/**
 * 收集父会话全部子会话(含孙代,经 sessions.list 递归匹配)的写路径,
 * 按父 turn 归并。返回 Map<父 turn 号, 写路径明细(含归因置信度)>。
 *
 * 归并规则:tool/call 落在某父 turn 窗口 [startAt, endAt/∞] 内 → 归该
 * turn;**窗口外的晚到结算**(异步子代理在父 turn 结束后才产出写入)→
 * 归「时间上最近的前序 turn」——委托工作的结算延迟不改其归属,P2-4:
 * 旧实现整条丢弃,该写入落入观测时间线被误标「外部(人工)」,反向污染
 * 三分语义。早于一切 turn 的孤儿调用照旧丢弃。
 */
export function collectSubagentWrites(
  parentSessionId: string,
  parentTurns: readonly { readonly turn: number; readonly startAt: number; readonly endAt: number | null }[],
  sessions: SessionsLike | undefined,
  repoRoot: string,
  presenter: ToolPresenter | undefined,
): ReadonlyMap<number, readonly WritePathDetail[]> {
  const byParentTurn = new Map<number, WritePathDetail[]>()
  if (sessions === undefined) return byParentTurn
  const children = (sessions.list() ?? []).filter((entry) => {
    const meta = entry.header?.meta
    return meta !== undefined && meta.origin === 'subagent' && meta.parentSession === parentSessionId
  })
  for (const child of children) {
    const session = sessions.get(child.id)
    if (session === undefined) continue // 冷子会话:跳过(文档化限制)
    const events = sliceEvents(session)
    // 最后一个 session/end-seed 之后才是子会话自己的工作。
    let fromSeq = 0
    for (const event of events) {
      if (event.type === 'session/end-seed') fromSeq = event.seq + 1
    }
    for (const event of events) {
      if (event.type !== 'tool/call' || event.seq < fromSeq) continue
      const details = extractWritePathDetails(event.data.name, event.data.arguments, repoRoot, presenter)
      if (details.length === 0) continue
      const parentTurn = parentTurns.find((turn) => {
        const end = turn.endAt ?? Number.POSITIVE_INFINITY
        return event.time >= turn.startAt && event.time <= end
      }) ?? latestTurnBefore(parentTurns, event.time)
      if (parentTurn === undefined) continue
      const bucket = byParentTurn.get(parentTurn.turn) ?? []
      bucket.push(...details)
      byParentTurn.set(parentTurn.turn, bucket)
    }
  }
  return byParentTurn
}

/** 时间上最近的前序 turn(startAt <= time 的最后一个;turns 升序)。
 * running turn 窗口为 [start, ∞),find 已覆盖——落到这里的一定晚于
 * 某个已结束 turn 的 endAt(晚到结算的归属回填)。 */
function latestTurnBefore(
  turns: readonly { readonly turn: number; readonly startAt: number }[],
  time: number,
): { readonly turn: number; readonly startAt: number } | undefined {
  let match: { readonly turn: number; readonly startAt: number } | undefined
  for (const turn of turns) {
    if (turn.startAt <= time) match = turn
    else break
  }
  return match
}