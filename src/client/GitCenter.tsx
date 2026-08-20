/**
 * Git center — the IDE-style management panel for one session's repository.
 *
 * Three tabs on a system-styled tab bar:
 *   Changes  — grouped lists (staged / unstaged / untracked) with per-file
 *              and bulk stage / unstage / discard, a commit box, and an
 *              inline diff preview for the selected file.
 *   History  — paginated commit list (50/page + load more) with a detail
 *              pane (metadata + file stats) and per-file commit diffs.
 *   Branches — local/remote branch lists, create-and-switch, switch, safe
 *              delete (two-step confirm).
 *
 * Feedback: successes are transient system Toasts; errors are a dismissible
 * in-panel banner. Discard/delete are destructive and require a second click
 * within 3s.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitAction, GitActionResult, GitBranch, GitChange, GitFileStat,
  GitQueryRequest, GitSnapshot,
} from '../host/types.ts'
import type { GraphCommit, GitRef } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import { createGraphBuilder, graphWidth, markFilterEnds, GRAPH_COLORS, type GraphRow, type GraphRowMarker } from './git-graph.ts'
import { buildFileTree, splitChangePath, type FileTreeNode } from './file-tree.ts'
import { formatWhen } from './time-format.ts'
import { buildSideBySide, capSideBySideRows, isBinaryDiff, summarizeChanges, type SideCell } from './side-by-side.ts'
import { diffBaseOf, reconcileDiffSelection, stepDiffSelection, type DiffSelection } from './changes-diff.ts'
import { BranchIcon, ChevronIcon, CloseIcon, CollapseAllIcon, DiffIcon, ExpandAllIcon, FileIcon, fileIconForPath, FolderIcon, NextIcon, PrevIcon, RollbackIcon, StageIcon, StarIcon, TagIcon, UnstageIcon } from './icons.tsx'
import type { GitKey } from './locales.ts'
import { SelectMenu } from './select-menu.tsx'
import * as css from './styles.ts'

export interface GitCenterProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly snapshot: GitSnapshot
  readonly run: (action: GitAction) => Promise<GitActionResult>
  readonly query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  readonly t: (key: GitKey) => string
  /** 打开定位：从 pill 点击变更文件而来——切到 changes 标签并打开该文件对照。 */
  readonly openRequest?: { readonly path: string; readonly base: 'worktree' | 'staged' } | null
}

type TabKey = 'changes' | 'history'

type Feedback = { readonly text: string } | null

interface ToastState {
  readonly text: string
  readonly seq: number
}

const HISTORY_PAGE = 1000

const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

/** IDEA 式时间：不足 60 分钟「x 分钟前」、今天/昨天 HH:mm，其余 Y/M/D HH:mm。 */
function timeAgo(iso: string, now: number, t: (key: GitKey) => string): string {
  return formatWhen(iso, now, {
    minutesAgo: (n) => t('time.minutesAgo').replace('{n}', String(n)),
    today: t('time.today'),
    yesterday: t('time.yesterday'),
  })
}

/**
 * The management panel. `snapshot` comes from the live controller view, so
 * every successful operation re-renders this component with fresh state.
 */
export function GitCenter({
  open, onClose, snapshot, run, query, t, openRequest = null,
}: GitCenterProps): JSX.Element | null {
  const [tab, setTab] = useState<TabKey>('changes')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  // 打开定位请求（pill 点击变更文件）：切到 changes 标签，由 ChangesTab
  // 响应 openRequest 打开该文件对照。openRequest 对象引用变化即再次定位。
  useEffect(() => {
    if (openRequest !== null) setTab('changes')
  }, [openRequest])

  /** Execute a management action with shared busy/feedback/toast handling. */
  const execute = async (action: GitAction, successText: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setFeedback(null)
    const result = await run(action)
    setBusy(false)
    if (result.ok) {
      setToast({ text: successText, seq: Date.now() })
      return true
    }
    setFeedback({ text: result.error.message ?? result.error.code })
    return false
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'changes', label: t('center.changes') },
    { key: 'history', label: t('center.history') },
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('center.title')} closeLabel={t('center.close')} headless className="dsh-git-ui__center">
      <div style={css.centerShell}>
        <div style={css.centerHeader}>
          <h2 style={css.centerTitle} title={snapshot.root}>{snapshot.branch ?? '(detached)'} — {t('center.title')}</h2>
          <Button size="sm" onClick={onClose} aria-label={t('center.close')}>✕</Button>
        </div>

        <div style={css.tabs} role="tablist">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`dsh-git-ui__tab${tab === key ? ' dsh-git-ui__tab--active' : ''}`}
              style={tab === key ? { ...css.tab, ...css.tabActive } : css.tab}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={css.centerBody}>
          {feedback !== null && (
            <div style={css.feedbackError} role="alert">
              <span style={{ flex: 1 }}>{feedback.text}</span>
              <button type="button" style={css.feedbackClose} onClick={() => setFeedback(null)} aria-label={t('center.close')}>✕</button>
            </div>
          )}

          {/* 三标签保持挂载、display 切换：保留各自状态（选中/分页/分支列表），与 IDE 行为一致。 */}
          <div style={tab === 'changes' ? { display: 'contents' } : { display: 'none' }}>
            <ChangesTab snapshot={snapshot} busy={busy} execute={execute} query={query} t={t} openRequest={openRequest} />
          </div>
          <div style={tab === 'history' ? { display: 'contents' } : { display: 'none' }}>
            <HistoryTab query={query} run={run} t={t} />
          </div>
        </div>
      </div>
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => setToast(null)} />
      )}
    </Modal>
  )
}

// ── Changes tab ───────────────────────────────────────────────────────────

/** Changes 分组键（IDEA 式三段：已暂存更改 / 更改 / 未版本控制的文件）。 */
type ChangeGroupKey = 'staged' | 'unstaged' | 'untracked'

interface ChangeGroup {
  readonly key: ChangeGroupKey
  readonly labelKey: GitKey
  readonly items: readonly GitChange[]
}

/** 组内按路径字母序（IDEA 行为）。 */
function byPath(a: GitChange, b: GitChange): number {
  return a.path.localeCompare(b.path)
}

/** 一条变更所属的分组键（IDEA 三段：已暂存/更改/未版本控制）。 */
function groupKeyOfChange(c: GitChange): ChangeGroupKey {
  if (c.status === 'untracked') return 'untracked'
  return c.staged ? 'staged' : 'unstaged'
}

function ChangesTab({
  snapshot, busy, execute, query, t, openRequest = null,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  t: (key: GitKey) => string
  openRequest: { path: string; base: 'worktree' | 'staged' } | null
}): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState<string | 'all' | null>(null)
  /** 折叠的分组键。 */
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<ChangeGroupKey>>(new Set())
  /** 左栏宽度（IDEA 式自由拖拽）。 */
  const [leftW, setLeftW] = useState(360)
  /** 当前对照查看的文件（base 取决于暂存态）。 */
  const [diffSel, setDiffSel] = useState<DiffSelection | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const diffSeq = useRef(0)

  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  // IDEA 式三段分组：混合态（MM）双条目天然分列两组；组内路径字母序。
  const stagedItems = useMemo(() => snapshot.changes.filter((c) => c.staged).sort(byPath), [snapshot])
  const unstagedItems = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked').sort(byPath), [snapshot])
  const untrackedItems = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked').sort(byPath), [snapshot])
  const groups: readonly ChangeGroup[] = [
    { key: 'staged' as const, labelKey: 'changes.groupStaged' as const, items: stagedItems },
    { key: 'unstaged' as const, labelKey: 'changes.groupUnstaged' as const, items: unstagedItems },
    { key: 'untracked' as const, labelKey: 'changes.groupUnversioned' as const, items: untrackedItems },
  ].filter((g) => g.items.length > 0)

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 组级全选 / 全消选（半选态由视图按 some/all 推导）。 */
  const selectGroup = (items: readonly GitChange[], check: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of items) {
        if (check) next.add(c.path)
        else next.delete(c.path)
      }
      return next
    })
  }

  const toggleGroupClosed = (key: ChangeGroupKey): void => {
    setClosedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const showDiff = async (path: string, base: 'worktree' | 'staged'): Promise<void> => {
    const seq = ++diffSeq.current
    setDiffSel({ path, base })
    setDiffText(null)
    setDiffLoading(true)
    const outcome = await query({ kind: 'diff', path, base })
    if (seq !== diffSeq.current) return
    setDiffLoading(false)
    setDiffText(outcome.ok && outcome.value.kind === 'diff' ? outcome.value.text : null)
  }

  // 打开定位请求（pill 点击变更文件）：展开文件所在分组并打开对照。
  // 仅随 openRequest 对象引用变化触发；snapshot 轮询由下方 reconcile effect 专门处理。
  useEffect(() => {
    if (openRequest === null) return
    setClosedGroups((prev) => {
      const keys = snapshot.changes.filter((c) => c.path === openRequest.path).map(groupKeyOfChange)
      const need = [...new Set(keys)].filter((k) => prev.has(k))
      if (need.length === 0) return prev
      const next = new Set(prev)
      for (const k of need) next.delete(k)
      return next
    })
    void showDiff(openRequest.path, openRequest.base)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应 openRequest 引用变化；showDiff 每次渲染重建、snapshot 由 reconcile 协调
  }, [openRequest])

  // 差异视图跟随快照：管理操作成功/轮询刷新后，文件消失 → 关闭对照；
  // 暂存侧迁移（MM 双条目）→ 按新基线重取；内容也可能随操作变化 → 一律重取。
  useEffect(() => {
    if (diffSel === null) return
    const desired = reconcileDiffSelection(diffSel, snapshot.changes)
    if (desired === null) {
      diffSeq.current += 1
      setDiffSel(null)
      setDiffText(null)
    } else {
      void showDiff(desired.path, desired.base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 快照驱动的差异协调；showDiff 经 diffSeq 防竞态
  }, [snapshot])

  const commit = (): void => {
    const text = message.trim()
    if (text === '' || busy) return
    const paths = selected.size > 0 ? [...selected] : undefined
    void execute({ kind: 'commit', message: text, ...(paths === undefined ? {} : { paths }) }, t('center.done'))
      .then((ok) => { if (ok) { setSelected(new Set()); setMessage('') } })
  }

  const rowActions = {
    onToggle: toggle,
    onStage: (path: string) => void execute({ kind: 'stage', paths: [path] }, t('center.done')),
    onUnstage: (path: string) => void execute({ kind: 'unstage', paths: [path] }, t('center.done')),
    onDiscard: (path: string) => {
      if (armed === path) {
        void execute({ kind: 'discard', paths: [path] }, t('center.done'))
      } else {
        setArmed((prev) => (prev === path ? null : path))
      }
    },
  }

  /** 差异前后导航序列：三段分组顺序（已暂存 → 更改 → 未版本控制），
   * 排除目录条目（目录无 diff 语义，不应进入对照导航）。 */
  const navEntries = useMemo(() => groups.flatMap((g) => g.items).filter((c) => !c.isDirectory), [groups])

  /** 上一个/下一个更改（循环遍历）；未打开对照时定位第一条。 */
  const navigateDiff = (delta: number): void => {
    const next = stepDiffSelection(navEntries, diffSel, delta)
    if (next !== null) void showDiff(next.path, next.base)
  }

  /** 差异增删摘要（由 diffText 派生；空/无对照时为 null）。 */
  const diffSummary = useMemo(
    () => (diffText === null || diffText === '' ? null : summarizeChanges(buildSideBySide(diffText))),
    [diffText],
  )

  return (
    <div style={css.changesLayout}>
      <div style={{ ...css.changesLeft, width: leftW }}>
        <div style={css.toolRow}>
          <Button size="sm" disabled={busy || (unstagedItems.length === 0 && untrackedItems.length === 0)} onClick={() => void execute({ kind: 'stage-all' }, t('center.done'))}>
            {t('center.stageAll')}
          </Button>
          <Button size="sm" disabled={busy || stagedItems.length === 0} onClick={() => void execute({ kind: 'unstage-all' }, t('center.done'))}>
            {t('center.unstageAll')}
          </Button>
          <Button
            size="sm"
            disabled={busy || stagedItems.length + unstagedItems.length === 0}
            onClick={() => {
              if (armed === 'all') {
                void execute({ kind: 'discard-all' }, t('center.done'))
              } else {
                setArmed((prev) => (prev === 'all' ? null : 'all'))
              }
            }}
          >
            {armed === 'all' ? t('center.confirmDiscard') : t('center.discardAll')}
          </Button>
        </div>
        <div style={css.changesList}>
          {snapshot.changes.length === 0
            ? <div style={css.emptyNote}>{t('center.empty')}</div>
            : (
              <>
                {groups.map((group) => (
                  <div key={group.key}>
                    <ChangeGroupHeader
                      label={t(group.labelKey)}
                      count={group.items.length}
                      closed={closedGroups.has(group.key)}
                      allChecked={group.items.length > 0 && group.items.every((c) => selected.has(c.path))}
                      someChecked={group.items.some((c) => selected.has(c.path))}
                      onToggleClosed={() => toggleGroupClosed(group.key)}
                      onSelectAll={(check) => selectGroup(group.items, check)}
                      t={t}
                    />
                    {!closedGroups.has(group.key) && group.items.map((change) => (
                      <ChangeRow
                        key={change.path}
                        change={change}
                        checked={selected.has(change.path)}
                        busy={busy}
                        armed={armed}
                        diffActive={diffSel !== null && diffSel.path === change.path && diffSel.base === diffBaseOf(change)}
                        rowActions={rowActions}
                        onShowDiff={(p, b) => void showDiff(p, b)}
                        t={t}
                      />
                    ))}
                  </div>
                ))}
                {snapshot.truncated && (
                  <div style={css.emptyNote}>
                    {t('changes.listTruncated')
                      .replace('{count}', String(snapshot.changes.length))
                      .replace('{total}', String(snapshot.staged + snapshot.modified + snapshot.untracked))}
                  </div>
                )}
              </>
            )}
        </div>
        <div style={css.commitBox}>
          <textarea
            className="dsh-git-ui__commit-input"
            style={css.commitInput}
            placeholder={t('center.commitMessage')}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            }}
          />
          <div style={css.commitFooter}>
            {selected.size > 0 && (
              <span style={css.commitHint}>
                {t('center.commitSelected').replace('{count}', String(selected.size))}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={css.commitKbd} aria-hidden="true">⌘/Ctrl + ↵</span>
            <Button variant="primary" size="sm" disabled={busy || message.trim() === ''} onClick={commit}>
              {busy ? t('center.busy') : t('center.commit')}
            </Button>
          </div>
        </div>
      </div>
      <Splitter kind="col" onDrag={(dx) => setLeftW((w) => clampNum(w + dx, 280, 520))} />
      <div style={css.changesRight}>
        {diffSel === null
          ? <div style={css.rightEmptyZone}>{t('center.selectFileDiff')}</div>
          : (
            <>
              <div style={css.diffToolbar}>
                <span style={css.diffBaseBadge}>
                  {diffSel.base === 'staged' ? t('diff.baseStaged') : t('diff.baseWorktree')}
                </span>
                {(() => {
                  const { name, dir } = splitChangePath(diffSel.path)
                  return (
                    <>
                      {dir !== '' && <span style={css.diffPathDir} title={diffSel.path}>{dir}</span>}
                      <span style={css.diffPathName}>{name}</span>
                    </>
                  )
                })()}
                {diffSummary !== null && (diffSummary.add > 0 || diffSummary.del > 0) && (
                  <span style={css.diffSummary}>
                    {diffSummary.add > 0 && <span style={css.diffSummaryAdd}>+{diffSummary.add}</span>}
                    {diffSummary.del > 0 && <span style={css.diffSummaryDel}>−{diffSummary.del}</span>}
                  </span>
                )}
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('diff.prev')}
                  aria-label={t('diff.prev')}
                  disabled={busy || navEntries.length === 0}
                  onClick={() => navigateDiff(-1)}
                >
                  <PrevIcon />
                </button>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('diff.next')}
                  aria-label={t('diff.next')}
                  disabled={busy || navEntries.length === 0}
                  onClick={() => navigateDiff(1)}
                >
                  <NextIcon />
                </button>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('center.close')}
                  aria-label={t('center.close')}
                  onClick={() => { diffSeq.current += 1; setDiffSel(null); setDiffText(null) }}
                >
                  <CloseIcon />
                </button>
              </div>
              {diffLoading
                ? <div style={css.emptyNote}>{t('center.loading')}</div>
                : <DiffSideBySide text={diffText ?? ''} t={t} />}
            </>
          )}
      </div>
    </div>
  )
}

/**
 * IDEA 式分组头：粘性吸顶——组级全选（含半选态）+ 折叠箭头 + 名称 + 计数。
 * 复选框与折叠按钮为独立控件，均可键盘操作。
 */
function ChangeGroupHeader({
  label, count, closed, allChecked, someChecked, onToggleClosed, onSelectAll, t,
}: {
  label: string
  count: number
  closed: boolean
  allChecked: boolean
  someChecked: boolean
  onToggleClosed: () => void
  onSelectAll: (check: boolean) => void
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <div style={css.groupHeader}>
      <input
        type="checkbox"
        style={css.changeCheckbox}
        checked={allChecked}
        ref={(el) => { if (el !== null) el.indeterminate = someChecked && !allChecked }}
        onChange={(e) => onSelectAll(e.target.checked)}
        aria-label={`${label} ${t('changes.selectAll')}`}
      />
      <button type="button" style={css.groupHeaderToggle} onClick={onToggleClosed} aria-expanded={!closed}>
        <ChevronIcon open={!closed} />
        <span>{label}</span>
        <span style={css.groupHeaderCount}>{count}</span>
      </button>
    </div>
  )
}

/**
 * IDEA 式变更行：复选框 + 文件图标 + 状态着色文件名 + 弱化目录 + 行尾状态字母
 * + 悬停操作（对照 / 暂存|取消暂存 / 丢弃）。操作图标仅在悬停或键盘聚焦时显现，
 * 定宽槽位常驻占位，杜绝显现时的布局跳动；点击文件名打开对照（基线由条目暂存侧决定）。
 *
 * 选择按路径归并：混合态双条目共享同一复选框状态——提交以路径为限，
 * 勾选任一侧即整文件入提交，联动为有意设计（与 aria-label 仅标注路径一致）。
 */
function ChangeRow({
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

/** 并排差异对照查看器（IDEA 式：左变更前/右变更后，行号 + 状态着色）。
 * 超大差异仅渲染前 MAX_DIFF_ROWS 行，防止万行级 diff 卡死渲染。 */
const MAX_DIFF_ROWS = 2000

function DiffSideBySide({ text, t }: { text: string; t: (key: GitKey) => string }): JSX.Element {
  const rows = useMemo(() => buildSideBySide(text), [text])
  const capped = useMemo(() => capSideBySideRows(rows, MAX_DIFF_ROWS), [rows])
  if (isBinaryDiff(text)) return <div style={css.emptyNote}>{t('diff.binary')}</div>
  if (rows.length === 0) return <div style={css.emptyNote}>{t('center.diffEmpty')}</div>

  const colorOf = (kind: SideCell['kind']): CSSProperties =>
    kind === 'del' ? css.sbsDel : kind === 'add' ? css.sbsAdd : kind === 'empty' ? css.sbsEmpty : {}

  const renderCell = (cell: SideCell, key: string): JSX.Element => (
    <div key={key} style={{ ...css.sbsCell, ...colorOf(cell.kind) }}>
      <span style={css.sbsNum}>{cell.num ?? ''}</span>
      <span style={css.sbsCode}>{cell.text}</span>
    </div>
  )

  // 全量平铺文档（不折叠上下文）：每列各渲染一份完整行序列。
  // 双列独立横向滚动 + 容器统一纵向滚动（长文档可上下滚动浏览）。
  const renderColumn = (side: 'left' | 'right'): readonly JSX.Element[] =>
    capped.map((row, i) => renderCell(side === 'left' ? row.left : row.right, String(i)))

  return (
    <>
      <div style={css.sbsContainer}>
        <div style={css.sbsCol}>
          <div style={css.sbsColInner}>{renderColumn('left')}</div>
        </div>
        <div style={{ ...css.sbsCol, ...css.sbsColRight }}>
          <div style={css.sbsColInner}>{renderColumn('right')}</div>
        </div>
      </div>
      {rows.length > MAX_DIFF_ROWS && (
        <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(MAX_DIFF_ROWS))}</div>
      )}
    </>
  )
}

// ── Graph constants ──────────────────────────────────────────────────────

/** 每车道理想像素宽（收紧贴近 IDE 密度；超宽图时按 GRAPH_MAX_TRACK_W 压缩）。 */
const GRAPH_COL_W = 16
/** 图轨道最大像素宽：超宽分支图压缩车道宽以适配，防线条挤压右侧提交信息。 */
const GRAPH_MAX_TRACK_W = 192
/** 车道宽下限（再宽也不小于此，避免线条/节点重叠到不可读）。 */
const GRAPH_LANE_MIN_W = 8
/** 节点圆半径。 */
const GRAPH_NODE_R = 4
/** 节点圆半径下限（车道压缩时同步缩小）。 */
const GRAPH_NODE_MIN_R = 2

// ── History tab ───────────────────────────────────────────────────────────

function HistoryTab({
  query, run, t,
}: {
  query: GitCenterProps['query']
  run: GitCenterProps['run']
  t: (key: GitKey) => string
}): JSX.Element {
  const [commits, setCommits] = useState<readonly GraphCommit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<GraphCommit | null>(null)
  const [detail, setDetail] = useState<{ commit: GraphCommit; body: string; stats: readonly GitFileStat[] } | null>(null)
  /** 组合过滤条件（左树 ref + 工具栏搜索/用户/日期）；任一变化重载。 */
  const [filter, setFilter] = useState<{ ref: string | null; search: string; author: string; since: string }>({ ref: null, search: '', author: '', since: '' })
  /** 工具栏搜索输入（防抖 300ms 落地到 filter）。 */
  const [searchInput, setSearchInput] = useState('')
  const [authors, setAuthors] = useState<readonly string[]>([])
  const [tree, setTree] = useState<{
    current: string | null
    defaultBranch: string | null
    local: readonly GitBranch[]
    remote: readonly GitBranch[]
    tags: readonly GitBranch[]
  } | null>(null)
  /** 左树折叠的分组：标签默认收起（仓库可能标签很多，一屏铺满不美观），点击展开。 */
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set(['tags']))
  /** 文件树折叠的目录路径集合。 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  /** 三栏可拖拽尺寸：左宽/右宽/右栏上区比例。 */
  const [leftW, setLeftW] = useState(170)
  const [rightW, setRightW] = useState(360)
  const [rightTopPct, setRightTopPct] = useState(58)
  const rightBodyRef = useRef<HTMLDivElement>(null)
  /** now 随提交批次稳定，避免行 memo 因时间戳失效。 */
  const now = useMemo(() => Date.now(), [commits])
  /** 列表滚动容器与单航守卫（无限滚动）。 */
  const listRef = useRef<HTMLDivElement>(null)
  const inflightSkip = useRef<number | null>(null)
  /** 按过滤组合的历史首页缓存（上限 10，切回瞬显，减缓“闪烁”与加载延迟）。 */
  const historyCache = useRef(new Map<string, { commits: readonly GraphCommit[]; total: number }>())
  const cacheKey = (f: { ref: string | null; search: string; author: string; since: string }): string =>
    JSON.stringify([f.ref, f.search, f.author, f.since])
  const writeHistoryCache = (f: { ref: string | null; search: string; author: string; since: string }, commits: readonly GraphCommit[], total: number): void => {
    const cache = historyCache.current
    const key = cacheKey(f)
    cache.delete(key)
    cache.set(key, { commits, total })
    while (cache.size > 10) {
      const first = cache.keys().next().value
      if (first === undefined) break
      cache.delete(first)
    }
  }

  /**
   * 增量图构建：提交集合只增时仅模拟新增段并追加行，既有行对象引用保持不变
   * （CommitRow memo 命中，避免逐批追加触发全表重渲染）；集合整体替换
   * （过滤切换/缓存恢复）时新建 builder 从头构建。
   * 搜索条件下不分析提交关系、不渲染分支图——结果仅是跨引用的匹配条目，
   * 图几何清空，只平铺条目。
   */
  const searching = filter.search !== ''
  const builderRef = useRef(createGraphBuilder())
  const prevCommitsRef = useRef<readonly GraphCommit[]>([])
  const [graphRows, setGraphRows] = useState<readonly GraphRow[]>([])
  useEffect(() => {
    if (searching) {
      builderRef.current = createGraphBuilder()
      prevCommitsRef.current = commits
      setGraphRows([])
      return
    }
    const prev = prevCommitsRef.current
    const isExtension = prev.length <= commits.length && prev.every((c, i) => c.hash === commits[i]?.hash)
    if (!isExtension) {
      builderRef.current = createGraphBuilder()
      setGraphRows(builderRef.current.append(commits))
    } else if (commits.length > prev.length) {
      const newRows = builderRef.current.append(commits.slice(prev.length))
      if (newRows.length > 0) setGraphRows((existing) => [...existing, ...newRows])
    }
    prevCommitsRef.current = commits
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随提交集合/搜索态变化喂入 builder
  }, [commits, searching])

  const graphCols = useMemo(() => graphWidth(graphRows), [graphRows])
  /** 自适应车道宽：图宽超过 GRAPH_MAX_TRACK_W 时压缩车道，保全部车道可见、轨道有界、不挤压主题列。 */
  const laneW = useMemo(() => {
    if (graphCols === 0) return GRAPH_COL_W
    return Math.max(GRAPH_LANE_MIN_W, Math.min(GRAPH_COL_W, GRAPH_MAX_TRACK_W / graphCols))
  }, [graphCols])
  const graphTrack = searching ? 0 : Math.ceil(graphCols * laneW)
  /** 过滤（搜索/作者/日期）生效时，结果集不含部分父节点——延续线永久悬垂，标为端头。 */
  const hasContentFilter = filter.search !== '' || filter.author !== '' || filter.since !== ''
  const loadedHashes = useMemo(() => new Set(commits.map((c) => c.hash)), [commits])
  const graphMarked = useMemo(
    () => markFilterEnds(graphRows, loadedHashes, hasContentFilter),
    [graphRows, loadedHashes, hasContentFilter],
  )
  /** 表格列模板：图 | 提交(refs+主题) | 哈希 | 作者 | 时间；行与表头共用。
   * 主题列 minmax(96px,1fr) 保证宽图/加载回流时内容不被压缩到不可读。
   * 搜索条件下用装饰圆点列替代图列（28px 居中圆点），条目不紧贴左侧。 */
  const gridTpl = searching
    ? '28px minmax(96px,1fr) 72px 110px 110px'
    : `${graphTrack}px minmax(96px,1fr) 72px 110px 110px`
  /** 行序列：非搜索=带图几何的行（graphMarked）；搜索=无图几何的纯条目行（showGraph=false）。 */
  const listRows = useMemo<readonly GraphRowMarker[]>(
    () => searching
      ? commits.map((commit) => ({ commit, column: 0, verticals: [], joins: [], nodeFromTop: false, nodeContinues: false, edges: [] } as GraphRowMarker))
      : graphMarked,
    [searching, commits, graphMarked],
  )
  /** 右栏文件目录树（随选中提交的 stats 重算）。 */
  const fileTree = useMemo(() => (detail === null ? [] : buildFileTree(detail.stats)), [detail])

  const loadPage = async (skip: number, f: { ref: string | null; search: string; author: string; since: string }): Promise<void> => {
    if (inflightSkip.current !== null) return
    inflightSkip.current = skip
    setLoading(true)
    const outcome = await query({
      kind: 'history',
      limit: HISTORY_PAGE,
      skip,
      ...(f.ref !== null ? { ref: f.ref } : {}),
      ...(f.search !== '' ? { search: f.search } : {}),
      ...(f.author !== '' ? { author: f.author } : {}),
      ...(f.since !== '' ? { since: f.since } : {}),
    })
    setLoading(false)
    inflightSkip.current = null
    if (!outcome.ok) return
    if (outcome.value.kind !== 'history') return
    const page = outcome.value.commits
    const next = skip === 0 ? page : [...commits, ...page]
    setCommits(next)
    setTotal(outcome.value.total)
    writeHistoryCache(f, next, outcome.value.total)
  }

  /** 无限滚动：接近底部 240px 自动加载下一批。 */
  const onScroll = (): void => {
    const el = listRef.current
    if (el === null || loading || commits.length >= total) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) void loadPage(commits.length, filter)
  }

  // 加载过滤树（分支 + 标签 + 作者）；首次激活与 fetch 后复用。
  const loadTree = useCallback(async (): Promise<void> => {
    const [branches, tags, authorsOutcome] = await Promise.all([query({ kind: 'branches' }), query({ kind: 'tags' }), query({ kind: 'authors' })])
    setAuthors(authorsOutcome.ok && authorsOutcome.value.kind === 'authors' ? authorsOutcome.value.authors : [])
    setTree({
      current: branches.ok && branches.value.kind === 'branches' ? branches.value.current : null,
      defaultBranch: branches.ok && branches.value.kind === 'branches' ? branches.value.defaultBranch : null,
      local: branches.ok && branches.value.kind === 'branches' ? branches.value.local : [],
      remote: branches.ok && branches.value.kind === 'branches' ? branches.value.remote : [],
      tags: tags.ok && tags.value.kind === 'tags' ? tags.value.tags : [],
    })
  }, [query])

  /** fetch 远程引用后重载过滤树（刷新 ahead/behind + 远程分支列表）。 */
  const [fetching, setFetching] = useState(false)
  /** fetch 结果提示：成功=已同步远程；失败=错误信息。 */
  const [fetchNote, setFetchNote] = useState<string | null>(null)
  const onFetch = useCallback(async (): Promise<void> => {
    if (fetching) return
    setFetching(true)
    setFetchNote(null)
    const result = await run({ kind: 'fetch' })
    await loadTree()
    setFetching(false)
    setFetchNote(result.ok ? t('center.fetchDone') : result.error.message ?? result.error.code)
  }, [fetching, run, loadTree, t])

  // 首次激活：加载过滤树。
  useEffect(() => {
    void loadTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first activation only
  }, [])

  // 过滤变化：缓存命中瞬显；不清空旧数据，新数据就位后整体替换旧行，避免空白“闪烁”。
  useEffect(() => {
    setSelected(null)
    setDetail(null)
    const cached = historyCache.current.get(cacheKey(filter))
    if (cached !== undefined) {
      setCommits(cached.commits)
      setTotal(cached.total)
    }
    void loadPage(0, filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter-driven reload
  }, [filter])

  // 搜索防抖：停止输入 300ms 后才落地为过滤条件。
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const select = useCallback(async (commit: GraphCommit): Promise<void> => {
    setSelected(commit)
    setDetail(null)
    const outcome = await query({ kind: 'show', ref: commit.hash })
    if (outcome.ok && outcome.value.kind === 'show' && outcome.value.commit !== null) {
      setDetail({ commit: outcome.value.commit as GraphCommit, body: outcome.value.body, stats: outcome.value.stats })
    }
  }, [query])

  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleSection = (section: string): void => {
    setClosedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  /** 右栏头带：收起全部目录。 */
  const collapseAllDirs = (): void => {
    const paths: string[] = []
    const walk = (nodes: readonly FileTreeNode[]): void => {
      for (const n of nodes) {
        if (!n.dir) continue
        paths.push(n.path)
        walk(n.children)
      }
    }
    walk(fileTree)
    setCollapsed(new Set(paths))
  }

  return (
    <div style={css.historyLayout}>
        <div style={{ ...css.paneSide, width: leftW, borderRight: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px 0 0 12px' }}>
          <HistoryFilterTree
            tree={tree}
            filter={filter.ref === null ? { kind: 'all' } : { kind: 'ref', name: filter.ref }}
            onFilter={(f) => setFilter((prev) => ({ ...prev, ref: f.kind === 'all' ? null : f.name }))}
            closed={closedSections}
            onToggleSection={toggleSection}
            onFetch={onFetch}
            fetching={fetching}
            fetchNote={fetchNote}
            t={t}
          />
        </div>
        <Splitter kind="col" onDrag={(dx) => setLeftW((w) => clampNum(w + dx, 140, 320))} />
        <div style={css.historyColumn}>
          <div style={css.historyToolbar}>
            <input
              className="dsh-git-ui__branch-input"
              style={css.toolbarSearch}
              placeholder={t('history.search')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={t('history.search')}
            />
            <SelectMenu
              ariaLabel={t('history.branch')}
              value={filter.ref ?? ''}
              options={[
                { value: '', label: t('history.allBranches') },
                ...(tree?.local.map((b) => ({ value: b.name, label: b.name })) ?? []),
                ...(tree?.remote.map((b) => ({ value: b.name, label: b.name })) ?? []),
              ]}
              onSelect={(value) => setFilter((prev) => ({ ...prev, ref: value === '' ? null : value }))}
            />
            <SelectMenu
              ariaLabel={t('history.allUsers')}
              value={filter.author}
              options={[
                { value: '', label: t('history.allUsers') },
                ...authors.map((name) => ({ value: name, label: name })),
              ]}
              onSelect={(value) => setFilter((prev) => ({ ...prev, author: value }))}
            />
            <SelectMenu
              ariaLabel={t('history.allTime')}
              value={filter.since}
              options={[
                { value: '', label: t('history.allTime') },
                { value: '1 day ago', label: t('history.today') },
                { value: '7 days ago', label: t('history.last7d') },
                { value: '30 days ago', label: t('history.last30d') },
                { value: '90 days ago', label: t('history.last90d') },
              ]}
              onSelect={(value) => setFilter((prev) => ({ ...prev, since: value }))}
            />
          </div>
          <div
            style={{
              ...css.historyList,
              opacity: loading && commits.length > 0 ? 0.55 : 1,
              transition: 'opacity var(--ds-transition-duration) var(--ds-ease-in-out)',
            }}
            ref={listRef}
            onScroll={onScroll}
          >
            {loading && commits.length === 0 && (
              <div style={css.centeredEmpty}>{t('center.loading')}</div>
            )}
            {!loading && commits.length === 0 && (
              <div style={css.centeredEmpty}>{t('history.noResults')}</div>
            )}
            {commits.length > 0 && (
              <div style={{ ...css.historyHead, gridTemplateColumns: gridTpl }} aria-hidden="true">
                <span />
                <span>{t('history.commit')}</span>
                <span>{t('history.hash')}</span>
                <span>{t('history.author')}</span>
                <span>{t('history.time')}</span>
              </div>
            )}
            {listRows.map((row) => (
              <CommitRow
                key={row.commit.hash}
                row={row}
                cols={graphCols}
                laneW={laneW}
                gridTpl={gridTpl}
                isSelected={selected?.hash === row.commit.hash}
                now={now}
                onSelect={select}
                showGraph={!searching}
                t={t}
              />
            ))}
            {commits.length < total && (
              <div style={css.loadSentinel}>{loading ? t('center.loading') : ''}</div>
            )}
          </div>
        </div>
        <Splitter kind="col" onDrag={(dx) => setRightW((w) => clampNum(w - dx, 260, 560))} />
        <div style={{ ...css.paneSide, width: rightW, borderLeft: '1px solid var(--dsw-alias-border-l2)', borderRadius: '0 12px 12px 0' }}>
          <div style={css.paneHead}>
            <span style={css.commitHint}>{t('right.files')}</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={css.paneHeadButton}
              className="dsh-git-ui__refresh"
              aria-label={t('right.expandAll')}
              title={t('right.expandAll')}
              onClick={() => setCollapsed(new Set())}
            >
              <ExpandAllIcon />
            </button>
            <button
              type="button"
              style={css.paneHeadButton}
              className="dsh-git-ui__refresh"
              aria-label={t('right.collapseAll')}
              title={t('right.collapseAll')}
              onClick={collapseAllDirs}
            >
              <CollapseAllIcon />
            </button>
          </div>
          <div style={css.historyRight} ref={rightBodyRef}>
            {selected === null
              ? (
                <>
                  <div style={css.rightEmptyZone}>{t('right.selectCommit')}</div>
                  <div style={{ ...css.rightEmptyZone, ...css.rightEmptyZoneBottom }}>{t('right.commitDetails')}</div>
                </>
              )
              : (
                <>
                  <div style={{ ...css.rightFiles, flex: 'none', height: `${rightTopPct}%` }}>
                {detail === null
                  ? <div style={css.centeredEmpty}>{t('center.loading')}</div>
                  : detail.stats.length === 0
                    ? <div style={css.centeredEmpty}>{t('center.diffEmpty')}</div>
                    : (
                      <FileTreeNodes
                        nodes={fileTree}
                        collapsed={collapsed}
                        onToggle={toggleDir}
                      />
                    )}
              </div>
                  <Splitter
                    kind="row"
                    onDrag={(dy) => {
                      const h = rightBodyRef.current?.clientHeight ?? 1
                      setRightTopPct((p) => clampNum(p + (dy / h) * 100, 25, 75))
                    }}
                  />
                  <div style={css.rightMsg}>
                    <div style={css.commitDetailHeader}>
                      <span style={css.commitDetailSubject}>{selected.subject}</span>
                      <span style={css.commitDetailMeta}>
                        {selected.shortHash} · {selected.author} · {timeAgo(selected.dateIso, now, t)}
                      </span>
                    </div>
                    {detail !== null && detail.body !== ''
                      ? <pre style={css.msgBody}>{detail.body}</pre>
                      : <div style={css.centeredEmpty}>{t('right.noMessage')}</div>}
                  </div>
                </>
              )}
          </div>
        </div>
    </div>
  )
}

// ── 左栏过滤树与右栏文件树 ─────────────────────────────────────────────

/** 左栏：全部分支入口 + 本地/远程/标签可折叠分组，点击过滤历史。
 * 图标语义（IDEA 式）：默认分支=星形、当前检出=橙色签出标、普通=灰色分支、标签=标签形。 */
function HistoryFilterTree({
  tree, filter, onFilter, closed, onToggleSection, onFetch, fetching, fetchNote, t,
}: {
  tree: {
    current: string | null
    defaultBranch: string | null
    local: readonly GitBranch[]
    remote: readonly GitBranch[]
    tags: readonly GitBranch[]
  } | null
  filter: { kind: 'all' } | { kind: 'ref'; name: string }
  onFilter: (filter: { kind: 'all' } | { kind: 'ref'; name: string }) => void
  closed: ReadonlySet<string>
  onToggleSection: (section: string) => void
  onFetch: () => Promise<void>
  fetching: boolean
  fetchNote: string | null
  t: (key: GitKey) => string
}): JSX.Element {
  /** 搜索（分支或标签）：匹配行高亮，搜索时平铺展示并忽略折叠态。 */
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const searching = q !== ''
  const matches = (name: string): boolean => !searching || name.toLowerCase().includes(q)
  const highlight = (name: string): JSX.Element | string => {
    if (!searching) return name
    const idx = name.toLowerCase().indexOf(q)
    if (idx === -1) return name
    return (
      <>
        {name.slice(0, idx)}
        <span style={css.treeMatch}>{name.slice(idx, idx + q.length)}</span>
        {name.slice(idx + q.length)}
      </>
    )
  }
  const amber = 'var(--dsw-alias-state-warn-primary)'
  /** 分支图标与着色：当前检出 > 默认分支 > 普通。 */
  const branchFace = (name: string, bare: string): { icon: JSX.Element; color?: string } => {
    if (tree !== null && name === tree.current) return { icon: <TagIcon />, color: amber }
    if (tree !== null && tree.defaultBranch !== null && bare === tree.defaultBranch) return { icon: <StarIcon />, color: amber }
    return { icon: <BranchIcon /> }
  }
  const row = (name: string, bare: string, active: boolean, mark: boolean, indent: number, branch?: GitBranch): JSX.Element => {
    const face = branchFace(name, bare)
    const hasSync = branch !== undefined && ((branch.ahead ?? 0) > 0 || (branch.behind ?? 0) > 0)
    return (
      <button
        type="button"
        className="dsh-git-ui__row"
        style={{ ...(active ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow), paddingLeft: indent }}
        onClick={() => onFilter({ kind: 'ref', name })}
        title={name}
      >
        <span style={face.color === undefined ? css.treeIcon : { ...css.treeIcon, color: face.color }} aria-hidden="true">{face.icon}</span>
        <span style={mark ? { ...css.treeName, ...css.treeNameCurrent } : css.treeName}>{highlight(name)}</span>
        {hasSync && (
          <span style={css.treeSyncBadge}>
            {(branch!.ahead ?? 0) > 0 && `↑${branch!.ahead}`}
            {(branch!.ahead ?? 0) > 0 && (branch!.behind ?? 0) > 0 && ' '}
            {(branch!.behind ?? 0) > 0 && `↓${branch!.behind}`}
          </span>
        )}
        {mark && <span style={css.branchMark}>✓</span>}
      </button>
    )
  }
  const tagRow = (name: string): JSX.Element => (
    <button
      key={`t-${name}`}
      type="button"
      className="dsh-git-ui__row"
      style={{ ...(filter.kind === 'ref' && filter.name === name ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow), paddingLeft: 24 }}
      onClick={() => onFilter({ kind: 'ref', name })}
      title={name}
    >
      <span style={css.treeIcon} aria-hidden="true"><TagIcon /></span>
      <span style={css.treeName}>{highlight(name)}</span>
    </button>
  )
  const sectionHead = (key: string, label: string): JSX.Element => (
    <button type="button" style={css.treeSectionHead} onClick={() => onToggleSection(key)} aria-expanded={!closed.has(key)}>
      <ChevronIcon open={!closed.has(key)} />
      <span>{label}</span>
    </button>
  )
  // 远程按远程名分组为文件夹节点（IDEA 式 origin 文件夹）。
  const remoteGroups: Array<[string, readonly GitBranch[]]> = []
  if (tree !== null) {
    const map = new Map<string, GitBranch[]>()
    for (const b of tree.remote) {
      const slash = b.name.indexOf('/')
      const remoteName = slash === -1 ? b.name : b.name.slice(0, slash)
      const list = map.get(remoteName)
      if (list === undefined) map.set(remoteName, [b])
      else list.push(b)
    }
    remoteGroups.push(...map.entries())
  }
  const bareOf = (name: string): string => name.slice(name.indexOf('/') + 1)
  return (
    <>
      <div style={css.paneHead}>
        <input
          className="dsh-git-ui__branch-input"
          style={css.treeSearch}
          placeholder={t('history.searchTree')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('history.searchTree')}
        />
        <button
          type="button"
          className="dsh-git-ui__refresh"
          style={css.treeFetchBtn}
          onClick={() => void onFetch()}
          disabled={fetching}
          aria-label={t('center.fetch')}
          title={t('center.fetch')}
        >
          {fetching ? t('center.fetching') : t('center.fetch')}
        </button>
      </div>
      {fetchNote !== null && <div style={css.treeFetchNote}>{fetchNote}</div>}
      <div style={css.historyTree}>
        <button
          type="button"
          className="dsh-git-ui__row"
          style={filter.kind === 'all' ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow}
          onClick={() => onFilter({ kind: 'all' })}
        >
          <span style={css.treeIcon} aria-hidden="true"><BranchIcon /></span>
          <span style={css.treeName}>{t('history.allBranches')}</span>
        </button>
        {tree !== null && (searching ? (
          // 搜索态：匹配行平铺（本地→远程→标签），忽略折叠。
          <>
            {tree.local.filter((b) => matches(b.name)).map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24, b))}
            {tree.remote.filter((b) => matches(b.name)).map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, false, 24))}
            {tree.tags.filter((b) => matches(b.name)).map((b) => tagRow(b.name))}
          </>
        ) : (
          <>
            {sectionHead('local', t('center.localBranches'))}
            {!closed.has('local') && tree.local.map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24, b))}
            {tree.remote.length > 0 && sectionHead('remote', t('center.remoteBranches'))}
            {!closed.has('remote') && remoteGroups.map(([remoteName, branches]) => (
              <div key={`g-${remoteName}`}>
                <button
                  type="button"
                  className="dsh-git-ui__row"
                  style={{ ...css.treeRow, paddingLeft: 24 }}
                  onClick={() => onToggleSection(`remote:${remoteName}`)}
                  aria-expanded={!closed.has(`remote:${remoteName}`)}
                >
                  <span style={css.treeCaret}><ChevronIcon open={!closed.has(`remote:${remoteName}`)} /></span>
                  <span style={css.treeFolderIcon}><FolderIcon /></span>
                  <span style={css.treeName}>{remoteName}</span>
                </button>
                {!closed.has(`remote:${remoteName}`) && branches.map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, false, 44))}
              </div>
            ))}
            {tree.tags.length > 0 && sectionHead('tags', t('history.tags'))}
            {!closed.has('tags') && tree.tags.map((b) => tagRow(b.name))}
          </>
        ))}
      </div>
    </>
  )
}

/** 右栏文件目录树：引导线缩进、文件夹/文件图标、目录文件计数、可折叠。
 * 文件仅展示变更清单（按状态着色），点击查看差异已按定位移除。 */
function FileTreeNodes({
  nodes, collapsed, onToggle,
}: {
  nodes: readonly FileTreeNode[]
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => node.dir ? (
        <div key={node.path}>
          <button
            type="button"
            className="dsh-git-ui__row"
            style={css.treeRow}
            onClick={() => onToggle(node.path)}
            aria-expanded={!collapsed.has(node.path)}
          >
            <span style={css.treeCaret}><ChevronIcon open={!collapsed.has(node.path)} /></span>
            <span style={css.treeFolderIcon}><FolderIcon /></span>
            <span style={css.treeName}>{node.name}</span>
          </button>
          {!collapsed.has(node.path) && (
            <div style={css.treeChildren}>
              <FileTreeNodes
                nodes={node.children}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            </div>
          )}
        </div>
      ) : (
        <div key={node.path} className="dsh-git-ui__row" style={css.treeRow}>
          <span style={{ ...css.treeCaret, visibility: 'hidden' }} aria-hidden="true"><ChevronIcon open={false} /></span>
          <span style={{ ...css.treeFolderIcon, color: css.statusTextColor[node.status ?? 'modified'] }}><FileIcon /></span>
          <span style={{ ...css.treeName, color: css.statusTextColor[node.status ?? 'modified'] }} title={node.path}>{node.name}</span>
        </div>
      ))}
    </>
  )
}

/** 数值夹取。 */
function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 拖拽分割条：col/row 两向；拖动期间 window mousemove 累加 delta。 */
function Splitter({ kind, onDrag }: { kind: 'col' | 'row'; onDrag: (delta: number) => void }): JSX.Element {
  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault()
    let lastX = e.clientX
    let lastY = e.clientY
    const move = (ev: MouseEvent): void => {
      onDrag(kind === 'col' ? ev.clientX - lastX : ev.clientY - lastY)
      lastX = ev.clientX
      lastY = ev.clientY
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div
      className="dsh-git-ui__splitter"
      style={kind === 'col' ? css.splitter : css.splitterRow}
      role="separator"
      aria-orientation={kind === 'col' ? 'vertical' : 'horizontal'}
      onMouseDown={onMouseDown}
    />
  )
}

// ── 提交行（memo）与自绘下拉 ────────────────────────────────────────

/** 搜索条目装饰圆点取色：按提交 hash 字符码累加取模，稳定多彩（与分支图同一调色板）。 */
function dotColorOf(hash: string): string {
  let sum = 0
  for (let i = 0; i < hash.length; i += 1) sum += hash.charCodeAt(i)
  return GRAPH_COLORS[sum % GRAPH_COLORS.length]!
}

/** 提交行：memo 化保证千条级加载下过滤/选中变更仅重渲染受影响行。 */
const CommitRow = memo(function CommitRow({
  row, cols, laneW, gridTpl, isSelected, now, onSelect, showGraph, t,
}: {
  row: GraphRowMarker
  cols: number
  laneW: number
  gridTpl: string
  isSelected: boolean
  now: number
  onSelect: (commit: GraphCommit) => void
  showGraph: boolean
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <button
      type="button"
      className="dsh-git-ui__commit-row"
      style={{
        ...(isSelected ? { ...css.historyRow, ...css.historyRowSelected } : css.historyRow),
        gridTemplateColumns: gridTpl,
      }}
      onClick={() => onSelect(row.commit)}
    >
      {showGraph ? (
        <GraphStrip row={row} cols={cols} laneW={laneW} endOpen={row.endOpen} />
      ) : (
        <span style={css.searchDot} aria-hidden="true">
          <span style={{ ...css.searchDotInner, background: dotColorOf(row.commit.hash) }} />
        </span>
      )}
      <span style={css.historySubjectCell}>
        <RefPills refs={row.commit.refs} />
        <span style={css.commitSubjectLine} title={row.commit.subject}>{row.commit.subject}</span>
      </span>
      <span style={css.historyHash} title={row.commit.hash}>{row.commit.shortHash}</span>
      <span style={css.historyAuthor} title={row.commit.author}>{row.commit.author}</span>
      <span style={css.historyTime}>{timeAgo(row.commit.dateIso, now, t)}</span>
    </button>
  )
})



// ── refs 胶囊 ───────────────────────────────────────────────────────────

/**
 * 提交行内的分支/标签胶囊（IDEA 风格）：当前分支成功色、
 * 本地分支中性、远程弱化、标签警示色。最多展示 3 个，其余折叠为 +n。
 */
function RefPills({ refs }: { refs: readonly GitRef[] }): JSX.Element | null {
  if (refs.length === 0) return null
  const shown = refs.slice(0, 3)
  const rest = refs.length - shown.length
  const variant = (ref: GitRef): CSSProperties => {
    if (ref.head) return css.refPillHead
    switch (ref.kind) {
      case 'tag': return css.refPillTag
      case 'remote': return css.refPillRemote
      default: return css.refPillBranch
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: 'none', minWidth: 0 }} title={refs.map((r) => r.name).join(', ')}>
      {shown.map((ref) => (
        <span key={`${ref.kind}-${ref.name}`} style={{ ...css.refPill, ...variant(ref) }}>
          {ref.name}
        </span>
      ))}
      {rest > 0 && <span style={{ ...css.refPill, ...css.refPillRemote }}>+{rest}</span>}
    </span>
  )
}

// ── SVG graph strip ────────────────────────────────────────────────────────

/**
 * 一行的分支图：条带高度 = HISTORY_ROW_H（与行高同一常量），行间线条连续。
 * 竖线贯穿活跃车道；节点车道按 nodeFromTop / nodeContinues 画上下半段；
 * 分叉经 joins 水平连接汇入节点；merge 分裂为贝塞尔曲线（节点→行底）。
 * 宽度 = 全图车道数 × laneW（自适应车道宽，超宽图压缩以适配有界轨道、
 * 不挤压右侧提交信息）。
 */
function GraphStrip({ row, cols, laneW, endOpen }: { row: GraphRow; cols: number; laneW: number; endOpen?: boolean }): JSX.Element {
  const w = Math.max(cols, 1) * laneW
  const h = css.HISTORY_ROW_H
  const x = (col: number): number => col * laneW + laneW / 2
  const cy = h / 2
  const nodeR = Math.max(GRAPH_NODE_MIN_R, Math.min(GRAPH_NODE_R, laneW / 3))
  const color = (col: number): string => GRAPH_COLORS[col % GRAPH_COLORS.length]!
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      {row.verticals.map((col) => (
        <line key={`v-${col}`} x1={x(col)} y1={0} x2={x(col)} y2={h} stroke={color(col)} strokeWidth={1.5} strokeLinecap="round" />
      ))}
      {row.nodeFromTop && (
        <line x1={x(row.column)} y1={0} x2={x(row.column)} y2={cy} stroke={color(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      )}
      {row.joins.map((join) => (
        <g key={`j-${join}`}>
          {/* 汇聚车道：自上方竖线到节点高度，再水平连接线汇入节点（锚定父节点行）。 */}
          <line x1={x(join)} y1={0} x2={x(join)} y2={cy} stroke={color(join)} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={x(join)} y1={cy} x2={x(row.column)} y2={cy} stroke={color(join)} strokeWidth={1.5} strokeLinecap="round" />
        </g>
      ))}
      {row.nodeContinues && (endOpen === true ? (
        <>
          {/* 悬垂端头：父提交不在已加载集合（被过滤/边界），虚线 + 端止横杠，诚实提示上游未载入。 */}
          <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h - 5} stroke={color(row.column)} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
          <line x1={x(row.column) - 4} y1={h - 5} x2={x(row.column) + 4} y2={h - 5} stroke={color(row.column)} strokeWidth={1.5} strokeLinecap="round" />
        </>
      ) : (
        <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h} stroke={color(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      ))}
      {row.edges.map((edge, i) => (
        <path
          key={`e-${i}`}
          d={`M ${x(edge.from)} ${cy} C ${x(edge.from)} ${(cy + h) / 2}, ${x(edge.to)} ${(cy + h) / 2}, ${x(edge.to)} ${h}`}
          fill="none"
          stroke={color(edge.to)}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <circle
        cx={x(row.column)}
        cy={cy}
        r={nodeR}
        fill={color(row.column)}
        stroke="var(--dsw-alias-bg-layer-2)"
        strokeWidth={1.5}
      />
    </svg>
  )
}

