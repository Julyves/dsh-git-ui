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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitAction, GitActionResult, GitBranch, GitChange, GitFileStat,
  GitQueryRequest, GitSnapshot,
} from '../host/types.ts'
import type { GraphCommit, GitRef } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import { buildGraph, graphWidth, GRAPH_COLORS, type GraphRow } from './git-graph.ts'
import { parseUnifiedDiff, type DiffLineType } from './unified-diff.ts'
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

type TabKey = 'changes' | 'history' | 'branches'

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
    { key: 'branches', label: t('center.branches') },
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
          <div style={tab === 'branches' ? { display: 'contents' } : { display: 'none' }}>
            <BranchesTab snapshot={snapshot} busy={busy} execute={execute} query={query} t={t} />
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
  snapshot, busy, execute, query, t,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  query: GitCenterProps['query']
  t: (key: GitKey) => string
}): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState<string | 'all' | null>(null)
  // Diff preview state for the clicked file.
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  /** 请求序号令牌：连点文件时仅最新响应落地，陈旧响应不得覆盖新状态。 */
  const diffSeq = useRef(0)

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

  const showDiff = async (path: string, change: GitChange): Promise<void> => {
    const seq = ++diffSeq.current
    setDiffPath(path)
    setDiffText(null)
    setDiffLoading(true)
    const base = change.staged ? 'staged' : 'worktree'
    const outcome = await query({ kind: 'diff', path, base })
    if (seq !== diffSeq.current) return
    setDiffLoading(false)
    setDiffText(outcome.ok && outcome.value.kind === 'diff' ? outcome.value.text : null)
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
        setDiffPath(null)
        setDiffText(null)
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
              setDiffPath(null)
              setDiffText(null)
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
                onShowDiff={showDiff}
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
                onShowDiff={showDiff}
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
                onShowDiff={showDiff}
                t={t}
              />
            )}
          </>
        )}

      {diffPath !== null && (
        <div style={{ borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 }}>
          <div style={css.toolRow}>
            <span style={css.commitHint}>{diffPath}</span>
            <Button size="sm" aria-label={t('center.close')} onClick={() => { diffSeq.current += 1; setDiffPath(null); setDiffText(null) }}>✕</Button>
          </div>
          {diffLoading
            ? <div style={css.emptyNote}>{t('center.diffLoading')}</div>
            : <DiffView text={diffText ?? ''} t={t} />}
        </div>
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
  change, checked, busy, armed, rowActions, onShowDiff, t,
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
  onShowDiff: (path: string, change: GitChange) => void
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
      <button
        type="button"
        style={{
          ...css.changePathText,
          border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit',
        }}
        title={`${change.path} — ${t('center.showDiff')}`}
        onClick={() => onShowDiff(change.path, change)}
      >
        {change.path}
      </button>
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
  title, changes, checked, busy, armed, rowActions, onShowDiff, t,
}: {
  title: string
  changes: readonly GitChange[]
  checked: ReadonlySet<string>
  busy: boolean
  armed: string | 'all' | null
  rowActions: Parameters<typeof ChangeRow>[0]['rowActions']
  onShowDiff: (path: string, change: GitChange) => void
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
          onShowDiff={onShowDiff}
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
  const [detail, setDetail] = useState<{ commit: GraphCommit; stats: readonly GitFileStat[] } | null>(null)
  const [diff, setDiff] = useState<{ path: string; text: string | null; loading: boolean } | null>(null)
  /** 请求序号令牌：连点文件/切换提交时仅最新响应落地。 */
  const diffSeq = useRef(0)
  const now = Date.now()

  /** 由提交序列计算图行与车道宽（每次加载后重算）。 */
  const graphRows = useMemo(() => buildGraph(commits), [commits])
  const graphCols = useMemo(() => graphWidth(graphRows), [graphRows])
  /** 表格列模板：图 | 提交(refs+主题) | 哈希 | 作者 | 时间；行与表头共用。 */
  const gridTpl = `${graphCols * GRAPH_COL_W}px minmax(0,1fr) 64px 110px 76px`

  const loadPage = async (skip: number): Promise<void> => {
    setLoading(true)
    const outcome = await query({ kind: 'history', limit: HISTORY_PAGE, skip })
    setLoading(false)
    if (!outcome.ok) return
    if (outcome.value.kind !== 'history') return
    const page = outcome.value.commits
    setCommits((prev) => (skip === 0 ? page : [...prev, ...page]))
    setTotal(outcome.value.total)
  }

  useEffect(() => {
    void loadPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first activation only
  }, [])

  const select = async (commit: GraphCommit): Promise<void> => {
    diffSeq.current += 1
    setSelected(commit)
    setDetail(null)
    setDiff(null)
    const outcome = await query({ kind: 'show', ref: commit.hash })
    if (outcome.ok && outcome.value.kind === 'show' && outcome.value.commit !== null) {
      setDetail({ commit: outcome.value.commit as GraphCommit, stats: outcome.value.stats })
    }
  }

  const showFileDiff = async (ref: string, path: string): Promise<void> => {
    const seq = ++diffSeq.current
    setDiff({ path, text: null, loading: true })
    const outcome = await query({ kind: 'diff-commit', path, ref })
    if (seq !== diffSeq.current) return
    setDiff({
      path,
      text: outcome.ok && outcome.value.kind === 'diff-commit' ? outcome.value.text : null,
      loading: false,
    })
  }

  if (total === 0 && !loading && commits.length === 0) {
    return <div style={css.emptyNote}>{t('center.noCommits')}</div>
  }

  return (
    <div style={css.historyLayout}>
        <div style={css.historyList}>
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
            <Button size="sm" disabled={loading} onClick={() => void loadPage(commits.length)}>
              {t('center.loadMore').replace('{loaded}', String(commits.length)).replace('{total}', String(total))}
            </Button>
          )}
        </div>

        {selected === null
          ? <div style={css.historyHint}>{t('center.selectCommit')}</div>
          : (
            <div style={css.historyDetailShell}>
              <div style={css.historyDetailFiles}>
                <div style={css.commitDetailHeader}>
                  <span style={css.commitDetailSubject}>{selected.subject}</span>
                  <span style={css.commitDetailMeta}>
                    {selected.shortHash} · {selected.author} · {timeAgo(selected.dateIso, now, t)}
                  </span>
                </div>
                {detail === null
                  ? <div style={css.emptyNote}>{t('center.loading')}</div>
                  : detail.stats.length === 0
                    ? <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
                    : detail.stats.map((stat) => (
                      <div
                        key={stat.path}
                        className="dsh-git-ui__row"
                        style={diff?.path === stat.path ? { ...css.statRow, ...css.statRowActive } : css.statRow}
                        onClick={() => void showFileDiff(selected.hash, stat.path)}
                      >
                        <span style={css.statPath} title={stat.path}>{stat.path}</span>
                        <span style={css.statCounts}>
                          {stat.added > 0 && <span style={{ color: 'var(--dsw-alias-state-success-primary)' }}>+{stat.added}</span>}
                          {stat.deleted > 0 && <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>−{stat.deleted}</span>}
                        </span>
                      </div>
                    ))}
              </div>
              <div style={css.historyDetailDiff}>
                {diff === null
                  ? <div style={css.emptyNote}>{t('center.selectFile')}</div>
                  : (
                    <>
                      <div style={css.toolRow}>
                        <span style={css.commitHint}>{diff.path}</span>
                        <Button size="sm" aria-label={t('center.close')} onClick={() => { diffSeq.current += 1; setDiff(null) }}>✕</Button>
                      </div>
                      {diff.loading
                        ? <div style={css.emptyNote}>{t('center.diffLoading')}</div>
                        : <DiffView text={diff.text ?? ''} t={t} />}
                    </>
                  )}
              </div>
            </div>
          )}
    </div>
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
          stroke={color(edge.from)}
          strokeWidth={1.5}
        />
      ))}
      <circle
        cx={x(row.column)}
        cy={cy}
        r={GRAPH_NODE_R}
        fill={color(row.column)}
        stroke="var(--dsw-alias-bg-layer-3)"
        strokeWidth={1.5}
      />
    </svg>
  )
}

// ── Branches tab ──────────────────────────────────────────────────────────

function BranchesTab({
  snapshot, busy, execute, query, t,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  query: GitCenterProps['query']
  t: (key: GitKey) => string
}): JSX.Element {
  const [data, setData] = useState<{ current: string | null; local: readonly GitBranch[]; remote: readonly GitBranch[] } | null>(null)
  const [newName, setNewName] = useState('')
  const [newFrom, setNewFrom] = useState('')
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const [busyLocal, setBusyLocal] = useState(false)

  const reload = async (): Promise<void> => {
    const outcome = await query({ kind: 'branches' })
    if (outcome.ok && outcome.value.kind === 'branches') {
      setData({ current: outcome.value.current, local: outcome.value.local, remote: outcome.value.remote })
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first activation only
  }, [])

  useEffect(() => {
    if (deleteArmed === null) return
    const timer = setTimeout(() => setDeleteArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [deleteArmed])

  const createAndSwitch = async (): Promise<void> => {
    const name = newName.trim()
    if (name === '' || busyLocal) return
    setBusyLocal(true)
    const created = await execute({ kind: 'branch-create', name, ...(newFrom === '' ? {} : { from: newFrom }) }, t('center.done'))
    if (created) {
      await execute({ kind: 'branch-checkout', name }, t('center.done'))
      setNewName('')
      await reload()
    }
    setBusyLocal(false)
  }

  const switchTo = async (name: string): Promise<void> => {
    if (busyLocal) return
    setBusyLocal(true)
    await execute({ kind: 'branch-checkout', name }, t('center.done'))
    await reload()
    setBusyLocal(false)
  }

  const deleteBranch = async (name: string): Promise<void> => {
    if (deleteArmed !== name) {
      setDeleteArmed(name)
      return
    }
    setBusyLocal(true)
    await execute({ kind: 'branch-delete', name }, t('center.done'))
    setDeleteArmed(null)
    await reload()
    setBusyLocal(false)
  }

  const current = data?.current ?? snapshot.branch
  const fromOptions = data === null ? [] : data.local.map((b) => b.name)

  return (
    <>
      <div style={css.branchCreateRow}>
        <input
          className="dsh-git-ui__branch-input"
          style={css.branchNameInput}
          placeholder={t('center.branchName')}
          value={newName}
          disabled={busyLocal}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createAndSwitch() }}
        />
        {fromOptions.length > 0 && (
          <>
            <span style={css.commitHint}>{t('center.branchFrom')}</span>
            <select
              style={css.branchSelect}
              value={newFrom}
              disabled={busyLocal}
              onChange={(e) => setNewFrom(e.target.value)}
            >
              <option value="">{current ?? 'HEAD'}</option>
              {fromOptions.filter((name) => name !== current).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </>
        )}
        <Button variant="primary" size="sm" disabled={busyLocal || newName.trim() === ''} onClick={() => void createAndSwitch()}>
          {t('center.createAndSwitch')}
        </Button>
      </div>

      {data === null
        ? <div style={css.emptyNote}>{t('center.diffLoading')}</div>
        : (
          <>
            <div style={css.groupTitle}>{t('center.localBranches')}</div>
            {data.local.map((branch) => {
              const isCurrent = branch.name === current
              return (
                <div key={branch.name} className="dsh-git-ui__row" style={css.branchRow}>
                  {isCurrent && <span style={css.branchMark}>✓</span>}
                  <span style={isCurrent ? { ...css.branchName, ...css.branchCurrent } : css.branchName} title={branch.name}>
                    {branch.name}
                  </span>
                  {branch.shortHash !== null && <span style={css.branchHash}>{branch.shortHash}</span>}
                  {!isCurrent && (
                    <>
                      <Button size="sm" disabled={busyLocal} onClick={() => void switchTo(branch.name)}>{t('center.switchTo')}</Button>
                      <Button size="sm" disabled={busyLocal} onClick={() => void deleteBranch(branch.name)}>
                        {deleteArmed === branch.name ? t('center.confirmDeleteBranch') : t('center.deleteBranch')}
                      </Button>
                    </>
                  )}
                </div>
              )
            })}

            {data.remote.length > 0 && (
              <>
                <div style={css.groupTitle}>{t('center.remoteBranches')}</div>
                {data.remote.map((branch) => (
                  <div key={branch.name} className="dsh-git-ui__row" style={css.branchRow}>
                    <span style={css.branchName} title={branch.name}>{branch.name}</span>
                    <Button size="sm" disabled={busyLocal} onClick={() => void switchTo(branch.name)}>{t('center.switchTo')}</Button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
    </>
  )
}

// ── Diff view ─────────────────────────────────────────────────────────────

function diffStyle(type: DiffLineType): CSSProperties {
  switch (type) {
    case 'add': return css.diffLineAdd
    case 'del': return css.diffLineDel
    case 'hunk': return css.diffLineHunk
    case 'meta': return css.diffLineMeta
    default: return {}
  }
}

function DiffView({ text, t }: { text: string; t: (key: GitKey) => string }): JSX.Element {
  const lines = useMemo(() => parseUnifiedDiff(text), [text])
  if (lines.length === 0) return <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
  return (
    <div style={css.diffContainer}>
      {lines.map((line, index) => (
        <span key={index} style={{ ...css.diffLine, ...diffStyle(line.type) }}>{line.text || ' '}</span>
      ))}
    </div>
  )
}
