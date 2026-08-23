/**
 * Records tab — 逐 turn 工作记录(git 中心)。
 *
 * 数据:host `turn-records` 查询(按轮询/操作后的快照刷新键拉取)。
 * 结构:turn 升序列表(turn 1 → now),每行收敛为
 * `Turn {n} · 时间段 · 本会话 +N · 外部 +M`;展开为两组条目。
 * 条目:状态 chip + 路径 + state 徽章(仍变更/已提交/已还原);
 * 仍变更条目可点击 → 跳转 Changes 标签打开该文件对照(worktree 基线)。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { GitSnapshot, TurnWorkRecord, WorkEntry } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import type { GitKey } from './locales.ts'
import { useTurnRecords } from './use-turn-records.ts'
import { chipLetter } from './pill-segments.tsx'
import { ChevronIcon, fileIconForPath, FolderIcon } from './icons.tsx'
import { splitChangePath } from './file-tree.ts'
import * as css from './styles.ts'

export interface RecordsTabProps {
  readonly snapshot: GitSnapshot
  readonly query: (query: { readonly kind: 'turn-records' }) => Promise<GitQueryOutcome>
  readonly t: (key: GitKey) => string
  /** 打开的变更文件(仍变更条目)→ 交给 GitCenter 定位 Changes 标签。 */
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
}

/** 时间段展示(短格式:今天 HH:mm,否则 M/D HH:mm)。 */
function rangeText(startAt: number, endAt: number | null, t: (key: GitKey) => string): string {
  const from = shortTime(startAt)
  const to = endAt === null ? `${shortTime(Date.now())} ${t('work.running')}` : shortTime(endAt)
  return t('work.range').replace('{from}', from).replace('{to}', to)
}

function shortTime(epochMs: number): string {
  const date = new Date(epochMs)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 空白占位(无记录 / 加载失败)。 */
function EmptyNote({ text }: { readonly text: string }): JSX.Element {
  return (
    <div style={css.emptyStateSmall}>
      <span style={css.emptyStateDot} aria-hidden="true" />
      {text}
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
  const stateLabel = entry.state === 'dirty'
    ? t('work.state.dirty')
    : entry.state === 'committed'
      ? t('work.state.committed')
      : t('work.state.reverted')
  const clickable = entry.state === 'dirty'
  return (
    <div style={css.workRow}>
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
        <span style={css.changeNamePopBtn} title={entry.path}>{name}</span>
      )}
      {dir !== '' && <span style={css.changeDirPop}>{dir}</span>}
      <span style={{ flex: 1 }} />
      <span style={css.workStateBadge} title={entry.path}>{stateLabel}</span>
    </div>
  )
}

/** 一个 turn 的折叠行。 */
function TurnRow({ turn, onOpenDiff, t }: {
  readonly turn: TurnWorkRecord
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const hasEntries = turn.internal.length > 0 || turn.external.length > 0
  return (
    <div>
      <button
        type="button"
        style={css.workTurnRow}
        onClick={() => { if (hasEntries) setOpen(!open) }}
        aria-expanded={open}
        aria-label={t(turn.hasWork ? 'work.expanded' : 'work.minimized')}
      >
        <ChevronIcon open={open} />
        <span style={{ flex: 'none', fontWeight: 500 }}>
          {t('work.turn').replace('{n}', String(turn.turn))}
        </span>
        <span style={css.workStateBadge}>{rangeText(turn.startAt, turn.endAt, t)}</span>
        {!turn.hasWork && <span style={{ flex: 1 }} />}
        {turn.hasWork && (
          <span style={css.workBadges}>
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
        )}
      </button>
      {open && turn.hasWork && (
        <div style={{ padding: '0 8px 8px 30px' }}>
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
      {!hasEntries && (
        <EmptyNote text={t('work.empty')} />
      )}
    </div>
  )
}

/** Records 面板主体。 */
export function RecordsTab({ snapshot, query, t, onOpenDiff }: RecordsTabProps): JSX.Element {
  const { records, failed } = useTurnRecords(query, snapshot.checkedAt)
  if (failed) return <EmptyNote text={t('work.loadFailed')} />
  if (records === null) {
    // 首次加载中(或查询未完成):保持空白,不闪加载态。
    return <div style={{ height: 8 }} />
  }
  if (records.length === 0 || !records.some((turn) => turn.hasWork)) {
    return <EmptyNote text={t('work.empty')} />
  }
  return (
    <div>
      {records.map((turn) => (
        <TurnRow key={turn.turn} turn={turn} onOpenDiff={onOpenDiff} t={t} />
      ))}
    </div>
  )
}