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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitAction, GitActionResult, GitBranch, GitChange, GitFileStat,
  GitQueryRequest, GitSnapshot,
} from '../host/types.ts'
import type { GraphCommit, GitRef } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import { buildGraph, graphWidth, GRAPH_COLORS, type GraphRow } from './git-graph.ts'
import { buildFileTree, type FileTreeNode } from './file-tree.ts'
import { formatWhen } from './time-format.ts'
import { buildSideBySide, type SideCell } from './side-by-side.ts'
import { diffBaseOf, reconcileDiffSelection, type DiffSelection } from './changes-diff.ts'
import { BranchIcon, ChevronIcon, CloseIcon, CollapseAllIcon, DiffIcon, ExpandAllIcon, FileIcon, FolderIcon, NextIcon, PrevIcon, RollbackIcon, StageIcon, StarIcon, TagIcon, UnstageIcon } from './icons.tsx'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

export interface GitCenterProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly snapshot: GitSnapshot
  readonly run: (action: GitAction) => Promise<GitActionResult>
  readonly query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  readonly t: (key: GitKey) => string
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
  open, onClose, snapshot, run, query, t,
}: GitCenterProps): JSX.Element | null {
  const [tab, setTab] = useState<TabKey>('changes')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

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
            <ChangesTab snapshot={snapshot} busy={busy} execute={execute} query={query} t={t} />
          </div>
          <div style={tab === 'history' ? { display: 'contents' } : { display: 'none' }}>
            <HistoryTab query={query} t={t} />
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

function ChangesTab({
  snapshot, busy, execute, query, t,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  t: (key: GitKey) => string
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

  /** 差异前后导航序列：三段分组顺序（已暂存 → 更改 → 未版本控制）。 */
  const navEntries = useMemo(() => groups.flatMap((g) => g.items), [groups])

  /** 上一个/下一个更改（循环遍历）；未打开对照时定位第一条。 */
  const navigateDiff = (delta: number): void => {
    if (navEntries.length === 0) return
    if (diffSel === null) {
      const first = navEntries[0]!
      void showDiff(first.path, diffBaseOf(first))
      return
    }
    const found = navEntries.findIndex((c) => c.path === diffSel.path && diffBaseOf(c) === diffSel.base)
    const index = found === -1 ? 0 : found
    const next = navEntries[(index + delta + navEntries.length) % navEntries.length]!
    void showDiff(next.path, diffBaseOf(next))
  }

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
            : groups.map((group) => (
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
            <span style={css.commitHint}>
              {selected.size > 0 ? t('center.commitSelected').replace('{count}', String(selected.size)) : t('center.commitHint')}
            </span>
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
                <span style={css.diffPath} title={diffSel.path}>{diffSel.path}</span>
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
  const slash = change.path.lastIndexOf('/')
  const name = slash === -1 ? change.path : change.path.slice(slash + 1)
  const dir = slash === -1 ? '' : change.path.slice(0, slash)
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
      <span style={css.rowFileIcon} aria-hidden="true"><FileIcon /></span>
      <button
        type="button"
        style={{ ...css.changeName, color: statusColor }}
        title={change.path}
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
          title={t('changes.actionDiff')}
          aria-label={t('changes.actionDiff')}
          disabled={busy}
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
  if (rows.length === 0) return <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
  const capped = rows.length > MAX_DIFF_ROWS ? rows.slice(0, MAX_DIFF_ROWS) : rows
  const cellStyle = (cell: SideCell, right: boolean): CSSProperties => ({
    ...css.sbsCell,
    ...(right ? css.sbsCellRight : {}),
    ...(cell.kind === 'del' ? css.sbsDel : cell.kind === 'add' ? css.sbsAdd : cell.kind === 'empty' ? css.sbsEmpty : {}),
  })
  return (
    <div style={css.sbsContainer}>
      {capped.map((row, i) => (
        <div key={i} style={css.sbsRow}>
          <span style={cellStyle(row.left, false)}>
            <span style={css.sbsNum}>{row.left.num ?? ''}</span>
            {row.left.text}
          </span>
          <span style={cellStyle(row.right, true)}>
            <span style={css.sbsNum}>{row.right.num ?? ''}</span>
            {row.right.text}
          </span>
        </div>
      ))}
      {rows.length > MAX_DIFF_ROWS && (
        <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(MAX_DIFF_ROWS))}</div>
      )}
    </div>
  )
}

// ── Graph constants ──────────────────────────────────────────────────────

/** 每车道像素宽：收紧以贴近 IDE 密度（旧值 28 过宽）。 */
const GRAPH_COL_W = 16
/** 节点圆半径。 */
const GRAPH_NODE_R = 4

// ── History tab ───────────────────────────────────────────────────────────

function HistoryTab({
  query, t,
}: {
  query: GitCenterProps['query']
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
  /** 左树折叠的分组。 */
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set())
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

  /** 由提交序列计算图行与车道宽（每次加载后重算）。 */
  const graphRows = useMemo(() => buildGraph(commits), [commits])
  const graphCols = useMemo(() => graphWidth(graphRows), [graphRows])
  /** 表格列模板：图 | 提交(refs+主题) | 哈希 | 作者 | 时间；行与表头共用。 */
  const gridTpl = `${graphCols * GRAPH_COL_W}px minmax(0,1fr) 64px 110px 110px`
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

  // 首次激活：并行加载过滤树（分支 + 标签）。
  useEffect(() => {
    void (async () => {
      const [branches, tags, authorsOutcome] = await Promise.all([query({ kind: 'branches' }), query({ kind: 'tags' }), query({ kind: 'authors' })])
      setAuthors(authorsOutcome.ok && authorsOutcome.value.kind === 'authors' ? authorsOutcome.value.authors : [])
      setTree({
        current: branches.ok && branches.value.kind === 'branches' ? branches.value.current : null,
        defaultBranch: branches.ok && branches.value.kind === 'branches' ? branches.value.defaultBranch : null,
        local: branches.ok && branches.value.kind === 'branches' ? branches.value.local : [],
        remote: branches.ok && branches.value.kind === 'branches' ? branches.value.remote : [],
        tags: tags.ok && tags.value.kind === 'tags' ? tags.value.tags : [],
      })
    })()
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
              transition: 'opacity var(--ds-transition-duration) linear',
            }}
            ref={listRef}
            onScroll={onScroll}
          >
            {loading && commits.length === 0 && (
              <div style={css.emptyNote}>{t('center.loading')}</div>
            )}
            {graphRows.length > 0 && (
              <div style={{ ...css.historyHead, gridTemplateColumns: gridTpl }} aria-hidden="true">
                <span />
                <span>{t('history.commit')}</span>
                <span>{t('history.hash')}</span>
                <span>{t('history.author')}</span>
                <span>{t('history.time')}</span>
              </div>
            )}
            {graphRows.map((row) => (
              <CommitRow
                key={row.commit.hash}
                row={row}
                cols={graphCols}
                gridTpl={gridTpl}
                isSelected={selected?.hash === row.commit.hash}
                now={now}
                onSelect={select}
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
                  ? <div style={css.emptyNote}>{t('center.loading')}</div>
                  : detail.stats.length === 0
                    ? <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
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
                    {detail !== null && detail.body !== '' && <pre style={css.msgBody}>{detail.body}</pre>}
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
  tree, filter, onFilter, closed, onToggleSection, t,
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
  const row = (name: string, bare: string, active: boolean, mark: boolean, indent: number): JSX.Element => {
    const face = branchFace(name, bare)
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
      </div>
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
            {tree.local.filter((b) => matches(b.name)).map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24))}
            {tree.remote.filter((b) => matches(b.name)).map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, false, 24))}
            {tree.tags.filter((b) => matches(b.name)).map((b) => tagRow(b.name))}
          </>
        ) : (
          <>
            {sectionHead('local', t('center.localBranches'))}
            {!closed.has('local') && tree.local.map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24))}
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

/** 提交行：memo 化保证千条级加载下过滤/选中变更仅重渲染受影响行。 */
const CommitRow = memo(function CommitRow({
  row, cols, gridTpl, isSelected, now, onSelect, t,
}: {
  row: GraphRow
  cols: number
  gridTpl: string
  isSelected: boolean
  now: number
  onSelect: (commit: GraphCommit) => void
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
      <GraphStrip row={row} cols={cols} />
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

/** 自绘下拉选择器（平台 Menu 规范）：取代原生 select，明暗主题与系统样式统一。 */
function SelectMenu({
  value, options, onSelect, ariaLabel,
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onSelect: (value: string) => void
  ariaLabel: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = (): void => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 140) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) ?? false) return
      if (menuRef.current?.contains(target) ?? false) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        style={css.toolbarSelect}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span style={css.selectLabel}>{current?.label ?? ''}</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            flex: 'none',
            transition: 'transform var(--ds-transition-duration-fast) linear',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        >
          <svg width={10} height={10} viewBox="0 0 10 10">
            <path d="M1.5 3 L5 7 L8.5 3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{ ...css.selectMenu, top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              style={o.value === value ? { ...css.selectOption, ...css.selectOptionActive } : css.selectOption}
              className="dsh-git-ui__row"
              onClick={() => { onSelect(o.value); setOpen(false) }}
            >
              <span style={{ ...css.treeCaret, visibility: o.value === value ? 'visible' : 'hidden' }} aria-hidden="true">✓</span>
              <span style={css.selectLabel}>{o.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

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
 * 分裂与 merge 回归为贝塞尔曲线（节点→行底）。
 * 宽度 = 全图车道数，超宽时由列表容器横向滚动（不再截断坍塌）。
 */
function GraphStrip({ row, cols }: { row: GraphRow; cols: number }): JSX.Element {
  const w = Math.max(cols, 1) * GRAPH_COL_W
  const h = css.HISTORY_ROW_H
  const x = (col: number): number => col * GRAPH_COL_W + GRAPH_COL_W / 2
  const cy = h / 2
  const color = (col: number): string => GRAPH_COLORS[col % GRAPH_COLORS.length]!
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      {row.verticals.map((col) => (
        <line key={`v-${col}`} x1={x(col)} y1={0} x2={x(col)} y2={h} stroke={color(col)} strokeWidth={1.5} />
      ))}
      {row.nodeFromTop && (
        <line x1={x(row.column)} y1={0} x2={x(row.column)} y2={cy} stroke={color(row.column)} strokeWidth={1.5} />
      )}
      {row.nodeContinues && (
        <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h} stroke={color(row.column)} strokeWidth={1.5} />
      )}
      {row.edges.map((edge, i) => (
        <path
          key={`e-${i}`}
          d={`M ${x(edge.from)} ${cy} C ${x(edge.from)} ${(cy + h) / 2}, ${x(edge.to)} ${(cy + h) / 2}, ${x(edge.to)} ${h}`}
          fill="none"
          stroke={color(edge.kind === 'split' ? edge.to : edge.from)}
          strokeWidth={1.5}
        />
      ))}
      <circle
        cx={x(row.column)}
        cy={cy}
        r={GRAPH_NODE_R}
        fill={color(row.column)}
        stroke="var(--dsw-alias-bg-layer-2)"
        strokeWidth={1.5}
      />
    </svg>
  )
}

