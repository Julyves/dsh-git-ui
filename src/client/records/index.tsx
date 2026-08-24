/**
 * Records tab（records v2）——时段时间轴视图（Git 中心「记录」标签）。
 *
 * 彻底取代旧形态（四格概览卡 + 图例条 + 左轴时间线）：本视图为
 * 单栏时段卡片流，顶部一行工具栏（摘要 + 过滤）。
 *
 * 数据：由 GitPill 统一拉取后下发（records prop）——本组件**不自行查询**，
 * 避免每会话双查询风暴（RecordsTab 恒挂载于 GitCenter）。
 *
 * 结构：
 *   - 工具栏：左「N 个时段 · M 个文件 · K 个仍待提交」摘要；右过滤
 *     Segmented（全部 / 本会话 / 外部）——过滤为纯客户端（复用 records
 *     全量），零额外查询（延续事故 488f678 的省查询纪律）；
 *   - 主体：时段卡片流（时间轴内嵌卡片左缘），最近时段默认展开，
 *     展开区分「本会话 / 外部」两组条目；
 *   - 空态 / 加载态：图标 + 主文案（不再单行文字）。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { TurnWorkRecord } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'
import { RecordIcon } from '../icons.tsx'
import { buildSessions, summarizeSessions } from './derive.ts'
import { SessionCard, type RecordFilter } from './session-card.tsx'
import * as css from './styles.ts'

export interface RecordsTabProps {
  /** turn 工作记录（GitPill 下发）；null = 未就绪/未开启。 */
  readonly records: readonly TurnWorkRecord[] | null
  readonly t: (key: GitKey) => string
  /** 打开的变更文件（仍变更条目）→ 交给 GitCenter 定位 Changes 标签。 */
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  /** 初始过滤（默认全部；测试与未来深度链接可注入）。 */
  readonly initialFilter?: RecordFilter
}

/** 空白占位（无记录 / 加载失败）：图标 + 文案。 */
function EmptyNote({ text, t }: { readonly text: string; readonly t: (key: GitKey) => string }): JSX.Element {
  void t
  return (
    <div style={css.recordsEmpty}>
      <span style={css.recordsEmptyIcon} aria-hidden="true"><RecordIcon /></span>
      <span style={css.recordsEmptyText}>{text}</span>
    </div>
  )
}

/** 过滤 Segmented 项定义(作者三分:全部 / 本会话 / 其他会话 / 外部)。 */
const FILTERS: readonly { readonly key: RecordFilter; readonly label: GitKey }[] = [
  { key: 'all', label: 'work.filter.all' },
  { key: 'internal', label: 'work.group.internal' },
  { key: 'sibling', label: 'work.group.sibling' },
  { key: 'external', label: 'work.group.external' },
]

/** Records 面板主体（数据受控：由 GitPill 下发）。
 *
 * 修复（2026-08-24）：过滤到无结果时**不得提前 return 空态**——那样会把
 * 含过滤按钮的工具栏一并丢弃，用户被卡死在空态页（无法切回其他过滤）。
 * 工具栏（摘要 + 过滤）恒渲染；空态只在内容区呈现，并按原因区分文案：
 *   - 无任何时段 → 「还没有工作时段」；
 *   - 有时段但当前过滤下无条目 → 「当前过滤下没有条目，切换其他筛选」。
 */
export function RecordsTab({ records, t, onOpenDiff, initialFilter = 'all' }: RecordsTabProps): JSX.Element {
  const [filter, setFilter] = useState<RecordFilter>(initialFilter)

  if (records === null) {
    return <EmptyNote text={t('work.loadFailed')} t={t} />
  }
  const sessions = buildSessions(records)
  // 过滤为纯客户端派生（不复用任何额外查询）。
  const visible = sessions.filter((session) => {
    if (filter === 'internal') return session.internal.length > 0
    if (filter === 'sibling') return session.sibling.length > 0
    if (filter === 'external') return session.external.length > 0
    return true
  })
  const summary = summarizeSessions(sessions)
  const latestTurn = sessions[sessions.length - 1]?.turn
  const emptyText = sessions.length === 0
    ? t('work.emptySessions')
    : t('work.emptyFiltered')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 工具栏：摘要 + 过滤（恒渲染——过滤切换是任何状态下的退出通道）。 */}
      <div style={css.recordsToolbar}>
        <span style={css.recordsSummaryText}>
          {t('work.summary')
            .replace('{sessions}', String(summary.sessions))
            .replace('{files}', String(summary.files))
            .replace('{dirty}', String(summary.dirty))}
        </span>
        <span style={css.recordsFilterGroup} role="group" aria-label={t('work.filter.all')}>
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              style={filter === key ? css.recordsFilterItemActive : css.recordsFilterItem}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(label)}
            </button>
          ))}
        </span>
      </div>

      {/* 内容区：时段卡片流，或按原因区分的空态（工具栏保持可操作）。 */}
      {visible.length === 0 ? (
        <EmptyNote text={emptyText} t={t} />
      ) : (
        <div style={css.sessionList}>
          {visible.map((session) => (
            <SessionCard
              key={session.turn}
              session={session}
              filter={filter}
              t={t}
              onOpenDiff={onOpenDiff}
              defaultOpen={session.turn === latestTurn}
            />
          ))}
        </div>
      )}
    </div>
  )
}
