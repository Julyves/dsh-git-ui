/**
 * Records tab — 逐 turn 工作记录(git 中心):时间线叙事。
 *
 * 数据:由 GitPill 统一拉取后下发(records prop)——本组件**不自行查询**,
 * 避免每会话双查询风暴(RecordsTab 恒挂载于 GitCenter)。
 *
 * 结构(重设计):
 *   - 顶部**概览卡**:Turn 总数 / 本会话 / 外部 / 仍变更 四格统计,页面级视觉重心;
 *   - 主体**时间线**:左轴(节点 + 竖线) + 右 turn 卡片;有工作 turn 为可展开卡片,
 *     连续空闲 turn 聚合为一条弱化行(不再独立占位——截图噪音根因);
 *   - turn 卡片头:`Turn {n}` + 时间窗(HH:mm 区间)+ 计数徽章(本会话蓝/外部灰);
 *     展开显两组条目(状态 chip + 路径拆分 + 相对时刻 + 状态四色徽章);
 *   - 仍变更条目可点击 → 跳转 Changes 标签打开该文件对照(worktree 基线)。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { TurnWorkRecord, WorkEntry } from '../host/types.ts'
import type { GitKey } from './locales.ts'
import { chipLetter } from './pill-segments.tsx'
import { buildTimelineRows, relativeTimeLabel, summarizeWork, workStateLabel } from './work-record-meta.ts'
import { ChevronIcon, fileIconForPath, FolderIcon, RecordIcon } from './icons.tsx'
import { splitChangePath } from './file-tree.ts'
import * as css from './styles.ts'

export interface RecordsTabProps {
  /** turn 工作记录(GitPill 下发);null = 未就绪/未开启。 */
  readonly records: readonly TurnWorkRecord[] | null
  readonly t: (key: GitKey) => string
  /** 打开的变更文件(仍变更条目)→ 交给 GitCenter 定位 Changes 标签。 */
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
}

// ── 纯派生与时间工具 ───────────────────────────────────────────────────────

function shortTime(epochMs: number): string {
  const date = new Date(epochMs)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 时间窗文本:HH:mm 区间(进行中补"进行中")。 */
function windowText(startAt: number, endAt: number | null, t: (key: GitKey) => string): string {
  const from = shortTime(startAt)
  const to = endAt === null ? `${shortTime(Date.now())} ${t('work.running')}` : shortTime(endAt)
  return t('work.range').replace('{from}', from).replace('{to}', to)
}

// ── 子组件 ────────────────────────────────────────────────────────────────

/** 空白占位(无记录 / 加载失败)。 */
function EmptyNote({ text }: { text: string }): JSX.Element {
  return (
    <div style={css.workEmptyState}>
      <span style={css.workEmptyIcon} aria-hidden="true"><RecordIcon /></span>
      <span style={css.workEmptyText}>{text}</span>
    </div>
  )
}

/** 一条工作条目(状态 chip + 路径 + state 徽章)。 */
function WorkEntryRow({ entry, onOpenDiff, t }: {
  readonly entry: WorkEntry
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const { name, dir, isDir } = splitChangePath(entry.path, entry.path.endsWith('/'))
  const stateLabel = workStateLabel(entry.state, t)
  const clickable = entry.state === 'dirty'
  return (
    <div className="dsh-git-ui__row" style={css.workRow}>
      <span
        style={{ ...css.changeChip, ...(css.chipStyles[entry.status] ?? css.chipStyles.untracked) }}
        title={entry.status}
      >
        {chipLetter(entry.status)}
      </span>
      <span style={css.rowFileIcon} aria-hidden="true">
        {isDir ? <FolderIcon /> : fileIconForPath(entry.path)}
      </span>
      {clickable ? (
        <button
          type="button"
          className="dsh-git-ui__change-link"
          style={css.changeNamePopBtn}
          title={entry.path}
          onClick={() => onOpenDiff(entry.path, 'worktree')}
        >
          {name}
        </button>
      ) : (
        <span style={css.changeNamePop} title={entry.path}>{name}</span>
      )}
      {dir !== '' && <span style={css.changeDirPop}>{dir}</span>}
      <span style={css.workEntryTime}>{relativeTimeLabel(entry.firstSeenAt, t)}</span>
      <span style={css.workStateBadgeStyle(entry.state)}>{stateLabel}</span>
    </div>
  )
}

/** 一个 turn 卡片(可展开)。 */
function TurnCard({ turn, onOpenDiff, t }: {
  readonly turn: TurnWorkRecord
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const hasEntries = turn.internal.length > 0 || turn.external.length > 0
  return (
    <div style={css.recordsTurnCard}>
      <button
        type="button"
        className="dsh-git-ui__work-turn"
        style={css.recordsTurnHead}
        onClick={() => { if (hasEntries) setOpen(!open) }}
        aria-expanded={hasEntries ? open : undefined}
        aria-label={t('work.turnMeta').replace('{n}', String(turn.turn)).replace('{time}', windowText(turn.startAt, turn.endAt, t))}
      >
        {hasEntries ? <ChevronIcon open={open} /> : <span style={{ width: 14, flex: 'none' }} aria-hidden="true" />}
        <span style={css.recordsTurnTitle}>{t('work.turn').replace('{n}', String(turn.turn))}</span>
        <span style={css.recordsTurnWindow}>{windowText(turn.startAt, turn.endAt, t)}</span>
        <span style={css.recordsTurnCounts}>
          {turn.internal.length > 0 && (
            <span style={css.workBadgeInternal} title={t('work.group.internal')}>
              <span style={css.workBadgeDotInternal} aria-hidden="true" />
              {t('work.group.internal')} {turn.internal.length}
            </span>
          )}
          {turn.external.length > 0 && (
            <span style={css.workBadgeExternal} title={t('work.group.external')}>
              <span style={css.workBadgeDotExternal} aria-hidden="true" />
              {t('work.group.external')} {turn.external.length}
            </span>
          )}
        </span>
      </button>
      {open && hasEntries && (
        <div style={css.recordsTurnBody}>
          {turn.internal.length > 0 && (
            <>
              <div style={css.workGroupTitle}>
                <span style={css.workBadgeDotInternal} aria-hidden="true" />
                {t('work.group.internal')}
              </div>
              {turn.internal.map((entry) => (
                <WorkEntryRow key={`i-${entry.path}`} entry={entry} onOpenDiff={onOpenDiff} t={t} />
              ))}
            </>
          )}
          {turn.external.length > 0 && (
            <>
              <div style={css.workGroupTitle}>
                <span style={css.workBadgeDotExternal} aria-hidden="true" />
                {t('work.group.external')}
              </div>
              {turn.external.map((entry) => (
                <WorkEntryRow key={`e-${entry.path}`} entry={entry} onOpenDiff={onOpenDiff} t={t} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 空闲 turn 聚合行:极简弱化,不占独立卡片。 */
function IdleRow({ from, to, t }: { readonly from: number; readonly to: number; readonly t: (key: GitKey) => string }): JSX.Element {
  const label = from === to
    ? t('work.idleSingle').replace('{n}', String(from))
    : t('work.idleRange').replace('{from}', String(from)).replace('{to}', String(to))
  return <div style={css.recordsIdleRow}>{label}</div>
}

/** 时间线行:左轴(节点 + 连线) + 内容。 */
function TimelineRow({ children, active, isLast }: {
  readonly children: JSX.Element | JSX.Element[]
  readonly active: boolean
  readonly isLast: boolean
}): JSX.Element {
  return (
    <div style={css.recordsTimelineRow}>
      <span style={css.recordsTimelineRail} aria-hidden="true">
        <span style={active ? css.recordsTimelineDot : css.recordsTimelineDotIdle} />
        {!isLast && <span style={active ? css.recordsTimelineLineActive : css.recordsTimelineLine} />}
      </span>
      {children}
    </div>
  )
}

// ── 主体 ──────────────────────────────────────────────────────────────────

/** Records 面板主体(数据受控:由 GitPill 下发)。 */
export function RecordsTab({ records, t, onOpenDiff }: RecordsTabProps): JSX.Element {
  if (records === null) {
    // 未就绪(首次加载 / 查询失败 / 浏览器降级):显示中性占位而非纯空白——
    // 「记录」为主动入口,空白无说明会让用户误以为功能未实现。
    return <EmptyNote text={t('work.loadFailed')} />
  }
  if (records.length === 0 || !records.some((turn) => turn.hasWork)) {
    return <EmptyNote text={t('work.emptyDetails')} />
  }

  const summary = summarizeWork(records)
  const rows = buildTimelineRows(records)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 概览卡 */}
      <div style={css.recordsSummary}>
        <div style={css.recordsSummaryItem}>
          <span style={css.recordsSummaryValue}>{summary.turns}</span>
          <span style={css.recordsSummaryLabel}>{t('work.summaryTurns')}</span>
        </div>
        <div style={css.recordsSummaryItem}>
          <span style={css.recordsSummaryValue}>
            <span style={css.recordsSummaryDotInternal} aria-hidden="true" />
            {summary.internal}
          </span>
          <span style={css.recordsSummaryLabel}>{t('work.summaryInternal')}</span>
        </div>
        <div style={css.recordsSummaryItem}>
          <span style={css.recordsSummaryValue}>
            <span style={css.recordsSummaryDotExternal} aria-hidden="true" />
            {summary.external}
          </span>
          <span style={css.recordsSummaryLabel}>{t('work.summaryExternal')}</span>
        </div>
        <div style={css.recordsSummaryItem}>
          <span style={css.recordsSummaryValue}>
            <span style={css.recordsSummaryDotDirty} aria-hidden="true" />
            {summary.dirty}
          </span>
          <span style={css.recordsSummaryLabel}>{t('work.summaryDirty')}</span>
        </div>
      </div>

      {/* 时间线 */}
      <div style={css.recordsTimeline}>
        {rows.map((row, index) => (
          <TimelineRow
            key={row.kind === 'turn' ? `t-${row.turn.turn}` : `i-${row.from}-${row.to}`}
            active={row.kind === 'turn'}
            isLast={index === rows.length - 1}
          >
            {row.kind === 'turn'
              ? <TurnCard turn={row.turn} onOpenDiff={onOpenDiff} t={t} />
              : <IdleRow from={row.from} to={row.to} t={t} />}
          </TimelineRow>
        ))}
      </div>
    </div>
  )
}
