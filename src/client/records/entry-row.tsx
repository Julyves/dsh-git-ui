/**
 * 条目行（records v2）：4 元素精简排版。
 *   [状态chip] [文件名(主,仍变更可点击跳 diff)] [目录(弱化)] ── [状态徽章(右对齐)]
 * 旧「相对时刻」列移除——相对时刻并入 title 悬停（信息不丢，行内噪音消除）。
 */
import type { JSX } from 'react'
import type { WorkEntry } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'
import { chipLetter } from '../pill-segments.tsx'
import { splitChangePath } from '../file-tree.ts'
import { relativeTimeLabel, workStateLabel } from '../work-record-meta.ts'
import { changeChip, chipStyles } from '../styles.ts'
import * as css from './styles.ts'

export interface EntryRowProps {
  readonly entry: WorkEntry
  readonly t: (key: GitKey) => string
  /** 打开 Git 中心并定位该文件 diff（仍变更条目）。 */
  readonly onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  /** 已提交条目 → 打开 Git 中心历史页定位该提交(缺省 = 纯展示)。 */
  readonly onOpenCommit?: (hash: string) => void
  /** 该条目所属分组(纠错按钮的改判方向)。 */
  readonly group?: 'internal' | 'sibling' | 'external'
  /** 人工改判归因(仓库级持久化;缺省 = 无纠错入口)。 */
  readonly onReclassify?: (path: string, to: 'internal' | 'external') => void
}

/** 一条工作条目（状态 chip + 文件名 + 目录 + 状态徽章）。 */
export function EntryRow({ entry, t, onOpenDiff, onOpenCommit, group, onReclassify }: EntryRowProps): JSX.Element {
  const { name, dir, isDir } = splitChangePath(entry.path, entry.path.endsWith('/'))
  const commitJump = entry.state === 'committed' && entry.commitHash !== null && onOpenCommit !== undefined
  const clickable = entry.state === 'dirty' || commitJump
  const relative = relativeTimeLabel(entry.firstSeenAt, t)
  const hint = isDir ? entry.path : `${entry.path} · ${relative}`
  const clickTitle = entry.state === 'dirty'
    ? hint
    : `${hint} · ${t('work.jumpCommit')}${entry.commitHash === null ? '' : ` (${entry.commitHash.slice(0, 7)})`}`
  return (
    <div className="dsh-git-ui__row" style={css.entryRow}>
      <span
        style={{ ...changeChip, ...(chipStyles[entry.status] ?? chipStyles.untracked) }}
        title={entry.status}
        aria-hidden="true"
      >
        {chipLetter(entry.status)}
      </span>
      {clickable ? (
        <button
          type="button"
          className="dsh-git-ui__change-link"
          style={css.entryName}
          title={clickTitle}
          onClick={() => {
            if (entry.state === 'dirty') {
              onOpenDiff(entry.path, 'worktree')
              return
            }
            if (entry.commitHash !== null) onOpenCommit?.(entry.commitHash)
          }}
        >
          {name}
        </button>
      ) : (
        <span style={css.entryName} title={hint}>{name}</span>
      )}
      {dir !== '' && <span style={css.entryDir} title={dir}>{dir}</span>}
      {entry.fresh === true && (
        <span style={css.entryFreshChip} title={t('work.freshChip')}>{t('work.freshChip')}</span>
      )}
      <span className="dsh-git-ui__row-actions" style={css.entryActions}>
        {onReclassify !== undefined && group !== undefined && (
          <button
            type="button"
            className="dsh-git-ui__icon-btn"
            style={css.entryReclassifyButton}
            title={group === 'internal' ? t('work.reclassify.external') : t('work.reclassify.internal')}
            aria-label={group === 'internal' ? t('work.reclassify.external') : t('work.reclassify.internal')}
            onClick={() => onReclassify(entry.path, group === 'internal' ? 'external' : 'internal')}
          >
            ⇄
          </button>
        )}
      </span>
      <span style={css.entryState}>
        <span
          style={entry.attribution === 'inferred' ? css.entryStateStyleInferred(entry.state) : css.entryStateStyle(entry.state)}
          title={entry.attribution === 'inferred' ? `${workStateLabel(entry.state, t)} · ${t('work.attribution.inferredHint')}` : undefined}
        >
          {workStateLabel(entry.state, t)}
          {entry.attribution === 'inferred' ? ' ≈' : ''}
        </span>
      </span>
    </div>
  )
}
