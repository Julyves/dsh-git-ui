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

import type { TurnWorkRecord, WorkEntry, WorkEntryState } from '../../host/types.ts'

/** 相邻有工作 turn 合并为同一时段的间隔阈值(ms)。默认 10 分钟。 */
export const SESSION_GAP_MS = 10 * 60 * 1000

/** 条目状态信息量排序:dirty(可行动) > committed(终态+深链) > reverted > gone。
 * 同一路径跨多 turn 的条目合并时,取信息量高者——「现在仍待处理」压过
 * 历史终态,终态压过中性待定。 */
const STATE_RANK: Record<WorkEntryState, number> = { dirty: 3, committed: 2, reverted: 1, gone: 0 }

/** 合并排序键:状态优先,同状态时权威自证(attribution)压过启发式推断——
 * 同路径被 turn1 启发式提取、turn3 平台自证写入时,合并取自证,
 * 不让已证实的条目退化回 ≈ 不确定标记。 */
function rankOf(entry: WorkEntry): number {
  return STATE_RANK[entry.state] * 2 + (entry.attribution === 'authoritative' ? 1 : 0)
}

/** 合并同路径的两份条目:整体取排序键高者,firstSeenAt 取更早
 * (首次出现时刻是路径属性,不是 turn 属性),fresh 任一为真即真
 * (任一轮曾标「新」即该路径对本时段是新产出)。 */
function mergeEntry(a: WorkEntry, b: WorkEntry): WorkEntry {
  const keep = rankOf(a) >= rankOf(b) ? a : b
  return {
    ...keep,
    firstSeenAt: Math.min(a.firstSeenAt, b.firstSeenAt),
    ...(a.fresh === true || b.fresh === true ? { fresh: true } : {}),
  }
}

/** 把 next 批条目按路径合并进 into(路径唯一化,保持字母序)。
 * host 归因是 per-turn 的——同一路径可出现在多个 turn 记录中;时段是
 * 路径级视图,合并须去重(BUG-R1:旧实现直接拼接,同卡片重复行 + 计数虚高)。 */
function mergeByPath(into: readonly WorkEntry[], next: readonly WorkEntry[]): readonly WorkEntry[] {
  if (next.length === 0) return into
  const map = new Map<string, WorkEntry>()
  for (const entry of into) map.set(entry.path, entry)
  for (const entry of next) {
    const existing = map.get(entry.path)
    map.set(entry.path, existing === undefined ? entry : mergeEntry(existing, entry))
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

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
  /** 任务叙事:时段内首个 turn 的用户指令摘要(null = 未捕获)。 */
  readonly narrative: string | null
  /** 本会话条目（跨 turn 路径并集,已按路径去重合并——见 mergeByPath）。 */
  readonly internal: readonly WorkEntry[]
  /** 其他 dsh 会话(同工作区)AI 写入条目（作者三分;跨 turn 去重）。 */
  readonly sibling: readonly WorkEntry[]
  /** 外部(人工)条目（跨 turn 路径并集,已去重）。 */
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
        // 叙事取时段内首个非空(首 turn 缺叙事时由后续 turn 补位)。
        narrative: last.narrative ?? turn.narrative,
        // 条目按路径去重合并(同一路径跨多 turn 只留一份,信息量高者胜)。
        internal: mergeByPath(last.internal, turn.internal),
        sibling: mergeByPath(last.sibling, turn.sibling),
        external: mergeByPath(last.external, turn.external),
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
    narrative: turn.narrative,
    internal: [...turn.internal],
    sibling: [...turn.sibling],
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
    files += session.internal.length + session.sibling.length + session.external.length
    for (const entry of session.internal) {
      if (entry.state === 'dirty') dirty += 1
    }
    for (const entry of session.sibling) {
      if (entry.state === 'dirty') dirty += 1
    }
    for (const entry of session.external) {
      if (entry.state === 'dirty') dirty += 1
    }
  }
  return { sessions: sessions.length, files, dirty }
}
