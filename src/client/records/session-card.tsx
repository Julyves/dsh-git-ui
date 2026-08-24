/**
 * 时段卡片（records v2）：时间轴内嵌左缘 + 头部（时间窗 + 徽章）+ 展开区。
 * 视图单位是「工作时段」——头部主标题为时间窗（HH:mm–HH:mm），
 * 聚合轮次与变更计数为徽章；展开区分「本会话 / 外部」两组条目。
 */
import { useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { WorkEntry } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'
import { workBadgeDotExternal, workBadgeDotInternal, workBadgeExternal, workBadgeInternal } from '../styles.ts'
import { ChevronIcon } from '../icons.tsx'
import { EntryRow } from './entry-row.tsx'
import type { WorkSession } from './derive.ts'
import * as css from './styles.ts'

export type RecordFilter = 'all' | 'internal' | 'external'

export interface SessionCardProps {
  readonly session: WorkSession
  readonly filter: RecordFilter
  readonly t: (key: GitKey) => string
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  /** 初始展开态（父组件默认展开最近时段）。 */
  readonly defaultOpen?: boolean
}

/** HH:mm 钟面。 */
function shortTime(epochMs: number): string {
  const date = new Date(epochMs)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 时段时间窗文本：HH:mm–HH:mm（进行中补「进行中」）。 */
function windowText(session: WorkSession, t: (key: GitKey) => string): string {
  const from = shortTime(session.startAt)
  const to = session.endAt === null
    ? `${shortTime(Date.now())} ${t('work.running')}`
    : shortTime(session.endAt)
  return t('work.range').replace('{from}', from).replace('{to}', to)
}

/** 一条分区条目包装（统一渲染路径）。 */
function EntryGroup({ title, dot, entries, t, onOpenDiff }: {
  readonly title: string
  readonly dot: CSSProperties
  readonly entries: readonly WorkEntry[]
  readonly t: (key: GitKey) => string
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
}): JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <>
      <div style={css.sessionGroupTitle}>
        <span style={dot} aria-hidden="true" />
        {title}
      </div>
      {entries.map((entry) => (
        <EntryRow key={entry.path} entry={entry} t={t} onOpenDiff={onOpenDiff} />
      ))}
    </>
  )
}

/** 一个时段卡片（可展开）。 */
export function SessionCard({ session, filter, t, onOpenDiff, defaultOpen = false }: SessionCardProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [hover, setHover] = useState(false)
  const showInternal = filter === 'all' || filter === 'internal'
  const showExternal = filter === 'all' || filter === 'external'
  const internalEntries = showInternal ? session.internal : []
  const externalEntries = showExternal ? session.external : []
  const hasEntries = internalEntries.length > 0 || externalEntries.length > 0

  const toggle = (): void => { if (hasEntries) setOpen(!open) }

  return (
    <div style={css.sessionCard} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* 左缘时间轴：节点 + 贯穿竖线（内嵌卡片）。 */}
      <span style={css.sessionRail} aria-hidden="true">
        <span style={css.sessionDot} />
        <span style={css.sessionLine} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <button
          type="button"
          className="dsh-git-ui__work-session"
          style={hover ? { ...css.sessionHead, ...css.sessionHeadHover } : css.sessionHead}
          onClick={toggle}
          aria-expanded={hasEntries ? open : undefined}
          aria-label={windowText(session, t)}
        >
          <ChevronIcon open={hasEntries && open} />
          <span style={css.sessionTitle}>{windowText(session, t)}</span>
          {session.turnCount > 1 && (
            <span style={css.sessionTurnCount}>{t('work.sessionTurnCount').replace('{n}', String(session.turnCount))}</span>
          )}
          <span style={css.sessionBadges}>
            {internalEntries.length > 0 && (
              <span style={workBadgeInternal} title={t('work.group.internal')}>
                <span style={workBadgeDotInternal} aria-hidden="true" />
                {t('work.group.internal')} {internalEntries.length}
              </span>
            )}
            {externalEntries.length > 0 && (
              <span style={workBadgeExternal} title={t('work.group.external')}>
                <span style={workBadgeDotExternal} aria-hidden="true" />
                {t('work.group.external')} {externalEntries.length}
              </span>
            )}
          </span>
        </button>
        {hasEntries && open && (
          <div style={css.sessionBody}>
            <EntryGroup
              title={t('work.group.internal')}
              dot={css.sessionGroupDotInternal}
              entries={internalEntries}
              t={t}
              onOpenDiff={onOpenDiff}
            />
            <EntryGroup
              title={t('work.group.external')}
              dot={css.sessionGroupDotExternal}
              entries={externalEntries}
              t={t}
              onOpenDiff={onOpenDiff}
            />
          </div>
        )}
      </div>
    </div>
  )
}
