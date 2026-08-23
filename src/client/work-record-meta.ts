/**
 * 工作记录的纯派生函数(无 react 依赖——保持与既有测试策略一致,
 * 可在 node 环境直接单测)。
 */

import type { TurnWorkRecord } from '../host/types.ts'

/** 最近一个含工具调用的 turn(pill 单 turn 窗口的数据源);无 → undefined。 */
export function latestWorkTurn(records: readonly TurnWorkRecord[] | null): TurnWorkRecord | undefined {
  if (records === null || records.length === 0) return undefined
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const turn = records[index]
    if (turn !== undefined && turn.hasWork) return turn
  }
  return undefined
}

/** 单 turn 窗口内的计数(仅非空才显示徽章)。 */
export function turnEntryCounts(turn: TurnWorkRecord | undefined): { internal: number; external: number } {
  if (turn === undefined) return { internal: 0, external: 0 }
  return { internal: turn.internal.length, external: turn.external.length }
}