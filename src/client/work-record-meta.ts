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

// ── 记录中心概览与时间线行(纯派生,无 react 依赖) ──────────────────────────

/**
 * 概览统计(对齐 pill 徽章语义:内部/外部/仍变更均取**最近工作 Turn**窗口,
 * 而非全会话累计——用户关注的"最近这轮"与徽章数字一致;turn.internal 在
 * 组装层已按路径去重,length 即唯一路径数;工作轮次为全会话总数)。
 */
export interface WorkSummary {
  readonly turns: number
  readonly internal: number
  readonly external: number
  readonly dirty: number
}

export function summarizeWork(records: readonly TurnWorkRecord[]): WorkSummary {
  const latest = latestWorkTurn(records)
  let internal = 0
  let external = 0
  let dirty = 0
  if (latest !== undefined) {
    internal = latest.internal.length
    external = latest.external.length
    for (const entry of latest.internal) {
      if (entry.state === 'dirty') dirty += 1
    }
    for (const entry of latest.external) {
      if (entry.state === 'dirty') dirty += 1
    }
  }
  return {
    turns: records.filter((turn) => turn.hasWork).length,
    internal,
    external,
    dirty,
  }
}

/** 时间线行:有工作 turn 或连续空闲 turn 聚合。 */
export type TimelineRow =
  | { readonly kind: 'turn'; readonly turn: TurnWorkRecord }
  | { readonly kind: 'idle'; readonly from: number; readonly to: number }

/**
 * 把 records(升序 turn)折叠为时间线行:连续 !hasWork 合并为一条 idle
 * (不再独立占位);hasWork 保持独立 turn 行。输入为升序;乱序输入按
 * turn 编号排序后折叠(防御)。
 */
export function buildTimelineRows(records: readonly TurnWorkRecord[]): readonly TimelineRow[] {
  const sorted = [...records].sort((a, b) => a.turn - b.turn)
  const rows: TimelineRow[] = []
  for (const turn of sorted) {
    if (turn.hasWork) {
      rows.push({ kind: 'turn', turn })
    } else {
      const last = rows[rows.length - 1]
      if (last !== undefined && last.kind === 'idle' && last.to === turn.turn - 1) {
        rows[rows.length - 1] = { kind: 'idle', from: last.from, to: turn.turn }
      } else {
        rows.push({ kind: 'idle', from: turn.turn, to: turn.turn })
      }
    }
  }
  return rows
}