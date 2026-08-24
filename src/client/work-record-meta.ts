/**
 * 工作记录的纯派生函数(无 react 依赖——保持与既有测试策略一致,
 * 可在 node 环境直接单测)。
 */

import type { GitKey } from './locales.ts'
import type { TurnWorkRecord, WorkEntryState } from '../host/types.ts'

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

/** 条目状态的 i18n 文案(dirty/committed/reverted/gone 四态)。 */
export function workStateLabel(state: WorkEntryState, t: (key: GitKey) => string): string {
  switch (state) {
    case 'dirty': return t('work.state.dirty')
    case 'committed': return t('work.state.committed')
    case 'reverted': return t('work.state.reverted')
    case 'gone': return t('work.state.gone')
  }
}

/**
 * 条目写入时刻的相对时间标签(复用 time.* 字典;未来时刻钳制为 0)。
 * 例:`2 分钟前`——让用户感知"这轮工作何时发生",不依赖绝对钟面。
 */
export function relativeTimeLabel(epochMs: number, t: (key: GitKey) => string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000))
  const fill = (template: GitKey, n: number): string => t(template).replace('{n}', String(n))
  if (seconds < 60) return t('time.justNow')
  if (seconds < 3600) return fill('time.minutesAgo', Math.floor(seconds / 60))
  if (seconds < 86_400) return fill('time.hoursAgo', Math.floor(seconds / 3600))
  return fill('time.daysAgo', Math.floor(seconds / 86_400))
}

