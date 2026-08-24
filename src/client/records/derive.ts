/**
 * 时段聚合：把逐 turn 工作记录折叠为「工作时段」(working session)。
 * 纯派生、无 react 依赖、无 I/O——可在 node 环境直接单测。
 *
 * 设计动机（见 .agent/records-redesign-design.md）：视图单位从工程概念
 * `Turn N` 转为用户心智的「时段」——连续有工作的 turn 间隔小于
 * `SESSION_GAP_MS` 则合并为一时段，idle turn 完全退出主视图。
 * 纯客户端派生：host/RPC 契约零改动（RecordsTab 数据源仍为 GitPill
 * 下发的 TurnWorkRecord[]，本模块负责视图层重塑）。
 */

import type { TurnWorkRecord, WorkEntry } from '../../host/types.ts'

/** 相邻有工作 turn 合并为同一时段的间隔阈值(ms)。默认 10 分钟。 */
export const SESSION_GAP_MS = 10 * 60 * 1000

/** 一个工作时段：连续有工作 turn 的聚合窗口。 */
export interface WorkSession {
  /** 首个 turn 号（诊断/调试用；UI 不再展示）。 */
  readonly turn: number
  /** 时段起点（首 turn startAt）。 */
  readonly startAt: number
  /** 时段终点（末 turn endAt）；null = 进行中。 */
  readonly endAt: number | null
  /** 聚合的 turn 数。 */
  readonly turnCount: number
  /** 本会话条目（路径并集；组装层已按路径去重）。 */
  readonly internal: readonly WorkEntry[]
  /** 外部条目（路径并集）。 */
  readonly external: readonly WorkEntry[]
}

/**
 * 把 records 折叠为时段列表（时间序）。
 * 规则：
 *   1. 仅 hasWork 的 turn 参与；idle turn 不产生时段；
 *   2. 相邻两 turn 的间隔 = next.startAt - prev.endAt；进行中（endAt null）
 *      的时段之后不再并入（其后不应再有新 turn，防御分支）；
 *   3. 间隔 <= gapMs（默认 SESSION_GAP_MS）→ 并入当前时段；否则新开时段；
 *      endAt 顺延取更晚者（进行中优先）；
 *   4. 输入乱序时按 turn 号排序（防御）。
 */
export function buildSessions(
  records: readonly TurnWorkRecord[] | null,
  gapMs: number = SESSION_GAP_MS,
): readonly WorkSession[] {
  if (records === null || records.length === 0) return []
  const sorted = [...records]
    .filter((turn) => turn.hasWork)
    .sort((a, b) => a.turn - b.turn)
  const sessions: WorkSession[] = []
  for (const turn of sorted) {
    const last = sessions[sessions.length - 1]
    if (last === undefined || last.endAt === null) {
      sessions.push(newSession(turn))
      continue
    }
    const gap = turn.startAt - last.endAt
    if (gap >= 0 && gap <= gapMs) {
      sessions[sessions.length - 1] = {
        ...last,
        turnCount: last.turnCount + 1,
        // 进行中(endAt null)优先；否则取更晚的结束时刻。
        endAt: turn.endAt === null ? null : Math.max(last.endAt, turn.endAt),
        internal: [...last.internal, ...turn.internal],
        external: [...last.external, ...turn.external],
      }
    } else {
      sessions.push(newSession(turn))
    }
  }
  return sessions
}

function newSession(turn: TurnWorkRecord): WorkSession {
  return {
    turn: turn.turn,
    startAt: turn.startAt,
    endAt: turn.endAt,
    turnCount: 1,
    internal: [...turn.internal],
    external: [...turn.external],
  }
}

/** 时段摘要计数（供工具栏文案）：时段数 / 文件总数 / 仍变更数。 */
export interface SessionSummary {
  readonly sessions: number
  readonly files: number
  readonly dirty: number
}

export function summarizeSessions(sessions: readonly WorkSession[]): SessionSummary {
  let files = 0
  let dirty = 0
  for (const session of sessions) {
    files += session.internal.length + session.external.length
    for (const entry of session.internal) {
      if (entry.state === 'dirty') dirty += 1
    }
    for (const entry of session.external) {
      if (entry.state === 'dirty') dirty += 1
    }
  }
  return { sessions: sessions.length, files, dirty }
}
