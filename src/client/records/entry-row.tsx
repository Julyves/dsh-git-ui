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
}

/** 一条工作条目（状态 chip + 文件名 + 目录 + 状态徽章）。 */
export function EntryRow({ entry, t, onOpenDiff, onOpenCommit }: EntryRowProps): JSX.Element {
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
      <span style={css.entryState}>
        <span style={css.entryStateStyle(entry.state)}>{workStateLabel(entry.state, t)}</span>
      </span>
    </div>
  )
}
