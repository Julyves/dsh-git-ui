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
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitAction, GitActionResult, GitBranch, GitChange, GitFileStat,
  GitQueryRequest, GitSnapshot,
} from '../host/types.ts'
import type { GraphCommit, GitRef } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import { buildGraph, graphWidth, GRAPH_COLORS, type GraphRow } from './git-graph.ts'
import { buildFileTree, type FileTreeNode } from './file-tree.ts'
import { BranchIcon, ChevronIcon, FileIcon, FolderIcon, StarIcon, TagIcon } from './icons.tsx'
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

const HISTORY_PAGE = 50

const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

/** Short relative time from an ISO date (same vocabulary as the popup). */
function timeAgo(iso: string, now: number, t: (key: GitKey) => string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  const fill = (template: GitKey, n: number): string => t(template).replace('{n}', String(n))
  if (seconds < 60) return t('time.justNow')
  if (seconds < 3600) return fill('time.minutesAgo', Math.floor(seconds / 60))
  if (seconds < 86_400) return fill('time.hoursAgo', Math.floor(seconds / 3600))
  return fill('time.daysAgo', Math.floor(seconds / 86_400))
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
            <ChangesTab snapshot={snapshot} busy={busy} execute={execute} t={t} />
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

function ChangesTab({
  snapshot, busy, execute, t,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  t: (key: GitKey) => string
}): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState<string | 'all' | null>(null)

  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const staged = useMemo(() => snapshot.changes.filter((c) => c.staged), [snapshot])
  const unstaged = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked'), [snapshot])
  const untracked = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked'), [snapshot])
  const hasTrackedChanges = staged.length + unstaged.length > 0

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

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

  return (
    <>
      <div style={css.toolRow}>
        <Button size="sm" disabled={busy || (unstaged.length === 0 && untracked.length === 0)} onClick={() => void execute({ kind: 'stage-all' }, t('center.done'))}>
          {t('center.stageAll')}
        </Button>
        <Button size="sm" disabled={busy || staged.length === 0} onClick={() => void execute({ kind: 'unstage-all' }, t('center.done'))}>
          {t('center.unstageAll')}
        </Button>
        <Button
          size="sm"
          disabled={busy || !hasTrackedChanges}
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

      {snapshot.changes.length === 0
        ? <div style={css.emptyNote}>{t('center.empty')}</div>
        : (
          <>
            {staged.length > 0 && (
              <ChangeGroup
                title={t('center.staged')}
                changes={staged}
                checked={selected}
                busy={busy}
                armed={armed}
                rowActions={rowActions}
                t={t}
              />
            )}
            {unstaged.length > 0 && (
              <ChangeGroup
                title={t('center.unstaged')}
                changes={unstaged}
                checked={selected}
                busy={busy}
                armed={armed}
                rowActions={rowActions}
                t={t}
              />
            )}
            {untracked.length > 0 && (
              <ChangeGroup
                title={t('center.untracked')}
                changes={untracked}
                checked={selected}
                busy={busy}
                armed={armed}
                rowActions={rowActions}
                t={t}
              />
            )}
          </>
        )}

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
          <Button variant="primary" size="sm" disabled={busy || message.trim() === ''} onClick={commit}>
            {busy ? t('center.busy') : t('center.commit')}
          </Button>
        </div>
      </div>
    </>
  )
}

/** One change row; clicking the path opens the inline diff preview. */
function ChangeRow({
  change, checked, busy, armed, rowActions, t,
}: {
  change: GitChange
  checked: boolean
  busy: boolean
  armed: string | 'all' | null
  rowActions: {
    onToggle: (path: string) => void
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    onDiscard: (path: string) => void
  }
  t: (key: GitKey) => string
}): JSX.Element {
  const untracked = change.status === 'untracked'
  return (
    <div className="dsh-git-ui__row" style={css.centerRow}>
      <input
        type="checkbox"
        style={css.changeCheckbox}
        checked={checked}
        disabled={busy}
        onChange={() => rowActions.onToggle(change.path)}
        aria-label={change.path}
      />
      <span style={{ ...css.changeChip, ...(css.chipStyles[change.status] ?? css.chipStyles.untracked) }} title={change.status}>
        {CHIP_LETTERS[change.status] ?? '•'}
      </span>
      {/* 路径仅展示变更清单；具体差异引导用户至 IDE 查看（插件定位）。 */}
      <span style={css.changePathText} title={change.path}>{change.path}</span>
      {change.staged
        ? <Button size="sm" disabled={busy} onClick={() => rowActions.onUnstage(change.path)}>{t('center.unstage')}</Button>
        : <Button size="sm" disabled={busy} onClick={() => rowActions.onStage(change.path)}>{t('center.stage')}</Button>}
      {!untracked && (
        <Button size="sm" disabled={busy} onClick={() => rowActions.onDiscard(change.path)}>
          {armed === change.path ? t('center.confirmDiscard') : t('center.discard')}
        </Button>
      )}
    </div>
  )
}

function ChangeGroup({
  title, changes, checked, busy, armed, rowActions, t,
}: {
  title: string
  changes: readonly GitChange[]
  checked: ReadonlySet<string>
  busy: boolean
  armed: string | 'all' | null
  rowActions: Parameters<typeof ChangeRow>[0]['rowActions']
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <>
      <div style={css.groupTitle}>{title}</div>
      {changes.map((change) => (
        <ChangeRow
          key={change.path}
          change={change}
          checked={checked.has(change.path)}
          busy={busy}
          armed={armed}
          rowActions={rowActions}
          t={t}
        />
      ))}
    </>
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
  const now = Date.now()

  /** 由提交序列计算图行与车道宽（每次加载后重算）。 */
  const graphRows = useMemo(() => buildGraph(commits), [commits])
  const graphCols = useMemo(() => graphWidth(graphRows), [graphRows])
  /** 表格列模板：图 | 提交(refs+主题) | 哈希 | 作者 | 时间；行与表头共用。 */
  const gridTpl = `${graphCols * GRAPH_COL_W}px minmax(0,1fr) 64px 110px 76px`
  /** 右栏文件目录树（随选中提交的 stats 重算）。 */
  const fileTree = useMemo(() => (detail === null ? [] : buildFileTree(detail.stats)), [detail])

  const loadPage = async (skip: number, f: { ref: string | null; search: string; author: string; since: string }): Promise<void> => {
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
    if (!outcome.ok) return
    if (outcome.value.kind !== 'history') return
    const page = outcome.value.commits
    setCommits((prev) => (skip === 0 ? page : [...prev, ...page]))
    setTotal(outcome.value.total)
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

  // 过滤变化：重置选中与列表并重载首页（含首次激活）。
  useEffect(() => {
    setSelected(null)
    setDetail(null)
    setCommits([])
    setTotal(0)
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

  const select = async (commit: GraphCommit): Promise<void> => {
    setSelected(commit)
    setDetail(null)
    const outcome = await query({ kind: 'show', ref: commit.hash })
    if (outcome.ok && outcome.value.kind === 'show' && outcome.value.commit !== null) {
      setDetail({ commit: outcome.value.commit as GraphCommit, body: outcome.value.body, stats: outcome.value.stats })
    }
  }

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

  return (
    <div style={css.historyLayout}>
        <HistoryFilterTree
          tree={tree}
          filter={filter.ref === null ? { kind: 'all' } : { kind: 'ref', name: filter.ref }}
          onFilter={(f) => setFilter((prev) => ({ ...prev, ref: f.kind === 'all' ? null : f.name }))}
          closed={closedSections}
          onToggleSection={toggleSection}
          t={t}
        />
        <div style={css.historyList}>
          <div style={css.historyToolbar}>
            <input
              className="dsh-git-ui__branch-input"
              style={css.toolbarSearch}
              placeholder={t('history.search')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={t('history.search')}
            />
            <select
              style={css.toolbarSelect}
              value={filter.ref ?? ''}
              aria-label={t('history.branch')}
              onChange={(e) => setFilter((prev) => ({ ...prev, ref: e.target.value === '' ? null : e.target.value }))}
            >
              <option value="">{t('history.allBranches')}</option>
              {tree?.local.map((b) => <option key={`l-${b.name}`} value={b.name}>{b.name}</option>)}
              {tree?.remote.map((b) => <option key={`r-${b.name}`} value={b.name}>{b.name}</option>)}
            </select>
            <select
              style={css.toolbarSelect}
              value={filter.author}
              aria-label={t('history.allUsers')}
              onChange={(e) => setFilter((prev) => ({ ...prev, author: e.target.value }))}
            >
              <option value="">{t('history.allUsers')}</option>
              {authors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select
              style={css.toolbarSelect}
              value={filter.since}
              aria-label={t('history.allTime')}
              onChange={(e) => setFilter((prev) => ({ ...prev, since: e.target.value }))}
            >
              <option value="">{t('history.allTime')}</option>
              <option value="1 day ago">{t('history.today')}</option>
              <option value="7 days ago">{t('history.last7d')}</option>
              <option value="30 days ago">{t('history.last30d')}</option>
              <option value="90 days ago">{t('history.last90d')}</option>
            </select>
          </div>
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
          {graphRows.map((row) => {
            const isSelected = selected?.hash === row.commit.hash
            return (
              <button
                key={row.commit.hash}
                type="button"
                className="dsh-git-ui__commit-row"
                style={{
                  ...(isSelected ? { ...css.historyRow, ...css.historyRowSelected } : css.historyRow),
                  gridTemplateColumns: gridTpl,
                }}
                onClick={() => void select(row.commit)}
              >
                <GraphStrip row={row} cols={graphCols} />
                <span style={css.historySubjectCell}>
                  <RefPills refs={row.commit.refs} />
                  <span style={css.commitSubjectLine} title={row.commit.subject}>{row.commit.subject}</span>
                </span>
                <span style={css.historyHash} title={row.commit.hash}>{row.commit.shortHash}</span>
                <span style={css.historyAuthor} title={row.commit.author}>{row.commit.author}</span>
                <span style={css.historyTime}>{timeAgo(row.commit.dateIso, now, t)}</span>
              </button>
            )
          })}
          {commits.length < total && (
            <Button size="sm" disabled={loading} onClick={() => void loadPage(commits.length, filter)}>
              {t('center.loadMore').replace('{loaded}', String(commits.length)).replace('{total}', String(total))}
            </Button>
          )}
        </div>

        {selected === null
          ? <div style={css.historyRight}><div style={css.emptyNote}>{t('center.selectCommit')}</div></div>
          : (
            <div style={css.historyRight}>
              <div style={css.rightFiles}>
                {detail === null
                  ? <div style={css.emptyNote}>{t('center.loading')}</div>
                  : detail.stats.length === 0
                    ? <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
                    : (
                      <FileTreeNodes
                        nodes={fileTree}
                        collapsed={collapsed}
                        onToggle={toggleDir}
                        t={t}
                      />
                    )}
              </div>
              <div style={css.rightMsg}>
                <div style={css.commitDetailHeader}>
                  <span style={css.commitDetailSubject}>{selected.subject}</span>
                  <span style={css.commitDetailMeta}>
                    {selected.shortHash} · {selected.author} · {timeAgo(selected.dateIso, now, t)}
                  </span>
                </div>
                {detail !== null && detail.body !== '' && <pre style={css.msgBody}>{detail.body}</pre>}
              </div>
            </div>
          )}
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
  const amber = 'var(--dsw-alias-state-warn-primary)'
  /** 分支图标与着色：当前检出 > 默认分支 > 普通。 */
  const branchFace = (name: string, bare: string): { icon: JSX.Element; color?: string } => {
    if (tree !== null && name === tree.current) return { icon: <TagIcon />, color: amber }
    if (tree !== null && tree.defaultBranch !== null && bare === tree.defaultBranch) return { icon: <StarIcon />, color: amber }
    return { icon: <BranchIcon /> }
  }
  const row = (name: string, bare: string, active: boolean, mark: boolean): JSX.Element => {
    const face = branchFace(name, bare)
    return (
      <button
        type="button"
        className="dsh-git-ui__row"
        style={active ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow}
        onClick={() => onFilter({ kind: 'ref', name })}
        title={name}
      >
        <span style={face.color === undefined ? css.treeIcon : { ...css.treeIcon, color: face.color }} aria-hidden="true">{face.icon}</span>
        <span style={mark ? { ...css.treeName, ...css.treeNameCurrent } : css.treeName}>{name}</span>
        {mark && <span style={css.branchMark}>✓</span>}
      </button>
    )
  }
  const sectionHead = (key: string, label: string): JSX.Element => (
    <button type="button" style={css.treeSectionHead} onClick={() => onToggleSection(key)} aria-expanded={!closed.has(key)}>
      <ChevronIcon open={!closed.has(key)} />
      <span>{label}</span>
    </button>
  )
  return (
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
      {tree !== null && (
        <>
          {sectionHead('local', t('center.localBranches'))}
          {!closed.has('local') && tree.local.map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current))}
          {tree.remote.length > 0 && sectionHead('remote', t('center.remoteBranches'))}
          {!closed.has('remote') && tree.remote.map((b) => {
            const bare = b.name.slice(b.name.indexOf('/') + 1)
            return row(b.name, bare, filter.kind === 'ref' && filter.name === b.name, false)
          })}
          {tree.tags.length > 0 && sectionHead('tags', t('history.tags'))}
          {!closed.has('tags') && tree.tags.map((b) => (
            <button
              key={`t-${b.name}`}
              type="button"
              className="dsh-git-ui__row"
              style={filter.kind === 'ref' && filter.name === b.name ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow}
              onClick={() => onFilter({ kind: 'ref', name: b.name })}
              title={b.name}
            >
              <span style={css.treeIcon} aria-hidden="true"><TagIcon /></span>
              <span style={css.treeName}>{b.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

/** 右栏文件目录树：引导线缩进、文件夹/文件图标、目录文件计数、可折叠。
 * 文件仅展示变更清单（按状态着色），点击查看差异已按定位移除。 */
function FileTreeNodes({
  nodes, collapsed, onToggle, t,
}: {
  nodes: readonly FileTreeNode[]
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  t: (key: GitKey) => string
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
            <span style={css.treeCounts}>{t('history.fileCount').replace('{n}', String(node.count))}</span>
          </button>
          {!collapsed.has(node.path) && (
            <div style={css.treeChildren}>
              <FileTreeNodes
                nodes={node.children}
                collapsed={collapsed}
                onToggle={onToggle}
                t={t}
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

