/**
 * 时段卡片（records v2）：时间轴内嵌左缘 + 头部（时间窗 + 徽章）+ 展开区。
 * 视图单位是「工作时段」——头部主标题为时间窗（HH:mm–HH:mm），
 * 聚合轮次与变更计数为徽章；展开区分「本会话 / 外部」两组条目。
 */
import { useState } from 'react'
import { shortTime } from '../center/shared.ts'
import type { CSSProperties, JSX } from 'react'
import type { WorkEntry } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'
import { workBadgeDotExternal, workBadgeDotInternal, workBadgeDotSibling, workBadgeExternal, workBadgeInternal, workBadgeSibling } from '../styles.ts'
import { ChevronIcon, RecordIcon, StageIcon } from '../icons.tsx'
import { EntryRow } from './entry-row.tsx'
import type { WorkSession } from './derive.ts'
import * as css from './styles.ts'

/** 作者三分过滤:全部 / 本会话 / 其他会话(AI) / 外部(人工)。 */
export type RecordFilter = 'all' | 'internal' | 'sibling' | 'external'

export interface SessionCardProps {
  readonly session: WorkSession
  readonly filter: RecordFilter
  readonly t: (key: GitKey) => string
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  /** 初始展开态（父组件默认展开最近时段）。 */
  readonly defaultOpen?: boolean
  /** 批量暂存(仍变更路径;缺省 = 无操作条)。 */
  readonly onStage?: (paths: readonly string[]) => void
  /** 已提交条目 → Git 中心历史页定位该提交。 */
  readonly onOpenCommit?: (hash: string) => void
  /** 人工改判归因(仓库级持久化;缺省 = 无纠错入口)。 */
  readonly onReclassify?: (path: string, to: 'internal' | 'sibling' | 'external') => void
}

/** HH:mm 钟面。 */
/** 时段时间窗文本：HH:mm–HH:mm（进行中补「进行中」）。 */
function windowText(session: WorkSession, t: (key: GitKey) => string): string {
  const from = shortTime(session.startAt)
  const to = session.endAt === null
    ? `${shortTime(Date.now())} ${t('work.running')}`
    : shortTime(session.endAt)
  return t('work.range').replace('{from}', from).replace('{to}', to)
}

/** 一条分区条目包装（统一渲染路径）。 */
function EntryGroup({ title, dot, group, entries, t, onOpenDiff, onOpenCommit, onReclassify }: {
  readonly title: string
  readonly dot: CSSProperties
  readonly group: 'internal' | 'sibling' | 'external'
  readonly entries: readonly WorkEntry[]
  readonly t: (key: GitKey) => string
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  readonly onOpenCommit?: (hash: string) => void
  readonly onReclassify?: (path: string, to: 'internal' | 'sibling' | 'external') => void
}): JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <>
      <div style={css.sessionGroupTitle}>
        <span style={dot} aria-hidden="true" />
        {title}
      </div>
      {entries.map((entry) => (
        <EntryRow key={entry.path} entry={entry} t={t} onOpenDiff={onOpenDiff} onOpenCommit={onOpenCommit} group={group} onReclassify={onReclassify} />
      ))}
    </>
  )
}

/** 一个时段卡片（可展开）。 */
export function SessionCard({ session, filter, t, onOpenDiff, defaultOpen = false, onStage, onOpenCommit, onReclassify }: SessionCardProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [hover, setHover] = useState(false)
  const showInternal = filter === 'all' || filter === 'internal'
  const showSibling = filter === 'all' || filter === 'sibling'
  const showExternal = filter === 'all' || filter === 'external'
  const internalEntries = showInternal ? session.internal : []
  const siblingEntries = showSibling ? session.sibling : []
  const externalEntries = showExternal ? session.external : []
  // 「有变更产出」基于时段**真实**条目数(非过滤后)——过滤只影响展示,
  // 不改变「这轮动没动文件」的事实(否则「仅看其它会话」过滤会误标无变更)。
  const hasEntries = session.internal.length > 0 || session.sibling.length > 0 || session.external.length > 0
  /** 批量暂存目标:AI 组 = 本会话+其他会话的仍变更;全部 = 三组仍变更。 */
  const dirtyPaths = (groups: 'ai' | 'all'): readonly string[] => {
    const pick = (entries: readonly WorkEntry[]): readonly string[] =>
      entries.filter((entry) => entry.state === 'dirty').map((entry) => entry.path)
    const ai = [...pick(session.internal), ...pick(session.sibling)]
    return groups === 'ai' ? ai : [...ai, ...pick(session.external)]
  }
  const aiDirty = onStage !== undefined && dirtyPaths('ai').length > 0
  const allDirty = onStage !== undefined && dirtyPaths('all').length > 0

  /** 任何时段(含无变更产出)都可展开:无条目的展开区显示空态而非不可点。 */
  const toggle = (): void => setOpen(!open)

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
          aria-expanded={open}
          aria-label={windowText(session, t)}
        >
          <ChevronIcon open={open} />
          {session.narrative !== null && (
            <span style={css.sessionNarrative} title={session.narrative}>{session.narrative}</span>
          )}
          <span style={session.narrative !== null ? css.sessionTitleMuted : css.sessionTitle} title={windowText(session, t)}>{windowText(session, t)}</span>
          {session.turnCount > 1 && (
            <span style={css.sessionTurnCount}>{t('work.sessionTurnCount').replace('{n}', String(session.turnCount))}</span>
          )}
          <span style={css.sessionBadges}>
            {!hasEntries && (
              <span style={css.sessionNoChange} title={t('work.noChangeHint')}>{t('work.noChange')}</span>
            )}
            {internalEntries.length > 0 && (
              <span style={workBadgeInternal} title={t('work.group.internal')}>
                <span style={workBadgeDotInternal} aria-hidden="true" />
                {t('work.group.internal')} {internalEntries.length}
              </span>
            )}
            {siblingEntries.length > 0 && (
              <span style={workBadgeSibling} title={t('work.group.sibling')}>
                <span style={workBadgeDotSibling} aria-hidden="true" />
                {t('work.group.sibling')} {siblingEntries.length}
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
        {open && (
          <div style={css.sessionBody}>
            {!hasEntries && (
              <div style={css.sessionEmpty}>
                <span style={css.sessionEmptyIcon} aria-hidden="true"><RecordIcon /></span>
                <span style={css.sessionEmptyText}>{t('work.noChangeEmpty')}</span>
              </div>
            )}
            <EntryGroup
              group="internal"
              title={t('work.group.internal')}
              dot={css.sessionGroupDotInternal}
              entries={internalEntries}
              t={t}
              onOpenDiff={onOpenDiff}
              onOpenCommit={onOpenCommit}
              onReclassify={onReclassify}
            />
            <EntryGroup
              group="sibling"
              title={t('work.group.sibling')}
              dot={css.sessionGroupDotSibling}
              entries={siblingEntries}
              t={t}
              onOpenDiff={onOpenDiff}
              onOpenCommit={onOpenCommit}
              onReclassify={onReclassify}
            />
            <EntryGroup
              group="external"
              title={t('work.group.external')}
              dot={css.sessionGroupDotExternal}
              entries={externalEntries}
              t={t}
              onOpenDiff={onOpenDiff}
              onOpenCommit={onOpenCommit}
              onReclassify={onReclassify}
            />
            {(aiDirty || allDirty) && (
              <div style={css.sessionActions}>
                {aiDirty && (
                  <button
                    type="button"
                    style={css.sessionActionButton}
                    title={t('work.stage.aiHint')}
                    onClick={() => onStage?.(dirtyPaths('ai'))}
                  >
                    <StageIcon />
                    {t('work.stage.ai')}
                  </button>
                )}
                {allDirty && (
                  <button
                    type="button"
                    style={css.sessionActionButtonSecondary}
                    title={t('work.stage.allHint')}
                    onClick={() => onStage?.(dirtyPaths('all'))}
                  >
                    <StageIcon />
                    {t('work.stage.all')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
