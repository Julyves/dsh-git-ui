import type { JSX } from 'react'
import type { GitChange } from '../../../host/types.ts'
import { diffBaseOf } from '../../changes-diff.ts'
import { splitChangePath } from '../../file-tree.ts'
import { DiffIcon, fileIconForPath, FolderIcon, RollbackIcon, StageIcon, UnstageIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'
import { CHIP_LETTERS } from '../shared.ts'


/**
 * IDEA 式变更行：复选框 + 文件图标 + 状态着色文件名 + 弱化目录 + 行尾状态字母
 * + 悬停操作（对照 / 暂存|取消暂存 / 丢弃）。操作图标仅在悬停或键盘聚焦时显现，
 * 定宽槽位常驻占位，杜绝显现时的布局跳动；点击文件名打开对照（基线由条目暂存侧决定）。
 *
 * 选择按路径归并：混合态双条目共享同一复选框状态——提交以路径为限，
 * 勾选任一侧即整文件入提交，联动为有意设计（与 aria-label 仅标注路径一致）。
 */
export function ChangeRow({
  change, checked, busy, armed, diffActive, rowActions, onShowDiff, t,
}: {
  change: GitChange
  checked: boolean
  busy: boolean
  armed: string | 'all' | null
  diffActive: boolean
  rowActions: {
    onToggle: (path: string) => void
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    onDiscard: (path: string) => void
  }
  onShowDiff: (path: string, base: 'worktree' | 'staged') => void
  t: (key: GitKey) => string
}): JSX.Element {
  const untracked = change.status === 'untracked'
  const { name, dir, isDir } = splitChangePath(change.path, change.isDirectory)
  const base = diffBaseOf(change)
  const armedHere = armed === change.path
  const statusColor = css.statusTextColor[change.status] ?? 'var(--dsw-alias-label-primary)'
  return (
    <div className="dsh-git-ui__row" style={diffActive ? { ...css.centerRow, ...css.centerRowActive } : css.centerRow}>
      <input
        type="checkbox"
        className="dsh-git-ui__checkbox"
        style={css.changeCheckbox}
        checked={checked}
        disabled={busy}
        onChange={() => rowActions.onToggle(change.path)}
        aria-label={change.path}
      />
      <span style={css.rowFileIcon} aria-hidden="true">
        {isDir ? <FolderIcon /> : fileIconForPath(change.path)}
      </span>
      <button
        type="button"
        style={isDir ? { ...css.changeName, color: statusColor, cursor: 'default' } : { ...css.changeName, color: statusColor }}
        title={isDir ? `${change.path} (${t('changes.dir')})` : change.path}
        disabled={isDir}
        onClick={() => onShowDiff(change.path, base)}
      >
        {name}
      </button>
      {dir !== '' ? <span style={css.changeDir}>{dir}</span> : <span style={{ flex: 1 }} />}
      <span style={{ ...css.statusLetter, color: statusColor }} aria-hidden="true">
        {CHIP_LETTERS[change.status] ?? '•'}
      </span>
      <span className="dsh-git-ui__row-actions" style={css.rowActions}>
        <button
          type="button"
          className="dsh-git-ui__icon-btn"
          style={css.rowIconButton}
          title={isDir ? t('changes.dir') : t('changes.actionDiff')}
          aria-label={isDir ? t('changes.dir') : t('changes.actionDiff')}
          disabled={busy || isDir}
          onClick={() => onShowDiff(change.path, base)}
        >
          <DiffIcon />
        </button>
        {untracked ? (
          <button
            type="button"
            className="dsh-git-ui__icon-btn"
            style={css.rowIconButton}
            title={t('center.stage')}
            aria-label={t('center.stage')}
            disabled={busy}
            onClick={() => rowActions.onStage(change.path)}
          >
            <StageIcon />
          </button>
        ) : change.staged ? (
          <button
            type="button"
            className="dsh-git-ui__icon-btn"
            style={css.rowIconButton}
            title={t('center.unstage')}
            aria-label={t('center.unstage')}
            disabled={busy}
            onClick={() => rowActions.onUnstage(change.path)}
          >
            <UnstageIcon />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="dsh-git-ui__icon-btn"
              style={css.rowIconButton}
              title={t('center.stage')}
              aria-label={t('center.stage')}
              disabled={busy}
              onClick={() => rowActions.onStage(change.path)}
            >
              <StageIcon />
            </button>
            <button
              type="button"
              className="dsh-git-ui__icon-btn"
              style={armedHere ? { ...css.rowIconButton, color: 'var(--dsw-alias-state-error-primary)' } : css.rowIconButton}
              title={armedHere ? t('center.confirmDiscard') : t('center.discard')}
              aria-label={armedHere ? t('center.confirmDiscard') : t('center.discard')}
              disabled={busy}
              onClick={() => rowActions.onDiscard(change.path)}
            >
              <RollbackIcon />
            </button>
          </>
        )}
      </span>
    </div>
  )
}
