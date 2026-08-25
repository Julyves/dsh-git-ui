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
import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties, JSX } from 'react'
import { useUI } from '../contracts/ui-context.tsx'
import type {
  GitAction, GitActionResult, GitBranch, GitChange, GitFileStat,
  GitQueryRequest, GitSnapshot, TurnWorkRecord,
} from '../host/types.ts'
import type { GraphCommit, GitRef } from '../host/types.ts'
import type { GitQueryOutcome } from './controller.ts'
import { colorOf, createGraphBuilder, graphWidth, markFilterEnds, GRAPH_COLORS, type GraphRow, type GraphRowMarker } from './git-graph.ts'
import { buildFileTree, splitChangePath, type FileTreeNode } from './file-tree.ts'
import { formatWhen } from './time-format.ts'
import { buildSideBySide, capSideBySideRows, extractAddedContent, foldContext, foldMarkerLines, isAddOnlyDiff, isBinaryDiff, summarizeChanges, type SideBySideRow, type SideCell } from './side-by-side.ts'
import { diffBaseOf, reconcileDiffSelection, stepDiffSelection, type DiffSelection } from './changes-diff.ts'
import { highlightLines, type HighlightSpan } from './syntax/highlighter.ts'
import { useHighlightReady } from './syntax/use-highlight-ready.ts'
import { langOfPath } from './syntax/lang-map.ts'
import { useWindowSlice } from './use-window-slice.ts'
import { BranchIcon, CheckIcon, ChevronIcon, CloseIcon, CollapseAllIcon, CommitIcon, DiffIcon, ExpandAllIcon, FileIcon, fileIconForPath, FolderIcon, GearIcon, NextIcon, PrevIcon, RecordIcon, RollbackIcon, StageIcon, StarIcon, TagIcon, UnstageIcon } from './icons.tsx'
import type { GitKey } from './locales.ts'
import { errorText } from './error-text.ts'
import { SelectMenu } from './select-menu.tsx'
import { SettingsTab } from './settings/SettingsTab.tsx'
import { useSettings } from './settings/use-settings.ts'
import { RecordsTab } from './records/index.tsx'
import { NewFileView } from './new-file-view.tsx'
import { DIFF_FOLD_THRESHOLD, type DiffSettings } from '../contracts/settings.ts'
import * as css from './styles.ts'
import { ChangesTab } from './center/changes/ChangesTab.tsx'
import { Splitter } from './center/Splitter.tsx'
import { clampNum } from './center/shared.ts'

export interface GitCenterProps {
  readonly open: boolean
  readonly onClose: () => void
  /** 打开时定位的 Tab（默认 changes）；pill 齿轮入口传 settings。 */
  readonly initialTab?: TabKey
  readonly snapshot: GitSnapshot
  readonly run: (action: GitAction) => Promise<GitActionResult>
  readonly query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  readonly t: (key: GitKey) => string
  /** 打开定位：从 pill 点击变更文件而来——切到 changes 标签并打开该文件对照。 */
  readonly openRequest?: { readonly path: string; readonly base: 'worktree' | 'staged' } | null
  /** turn 工作记录(由 GitPill 统一拉取并下发;null = 未就绪/未开启)。 */
  readonly records?: readonly TurnWorkRecord[] | null
  /** 人工改判归因(仓库级持久化;缺省 = 记录页无纠错入口)。 */
  readonly onReclassify?: (path: string, to: 'internal' | 'external') => void
}

/** Tab 键：设置 Tab 与功能 Tab 并列（信息架构：工作区 + 偏好区）。 */
type TabKey = 'changes' | 'history' | 'records' | 'settings'

/** GitCenter 的 Tab 键(供 GitPill 等调用方定位初始标签)。 */
export type GitCenterTab = TabKey

/** 反馈条：text 为展示文案（业务错误经 i18n 友好化）；detail 保留原始信息供 title。 */
type Feedback = { readonly text: string; readonly detail?: string } | null

interface ToastState {
  readonly text: string
  readonly seq: number
}

const HISTORY_PAGE = 300


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
  open, onClose, initialTab = 'changes', snapshot, run, query, t, openRequest = null, records = null, onReclassify,
}: GitCenterProps): JSX.Element | null {
  const { Modal, Toast } = useUI()
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 记录 Tab 跳转 Changes 的打开请求(仍变更条目点击)。 */
  const [recordOpenRequest, setRecordOpenRequest] = useState<{ path: string; base: 'worktree' | 'staged' } | null>(null)
  /** 记录 Tab 跳转 History 的定位请求(已提交条目点击 → 提交哈希)。
   * 对象态含 nonce:重复点击同一提交也产生新引用,重触发 HistoryTab 定位(H8)。 */
  const [commitRequest, setCommitRequest] = useState<{ hash: string; nonce: number } | null>(null)

  // 打开即定位（pill 齿轮 / 常规打开 / 变更文件直达）：open 上升沿重设 tab，
  // 而非依赖 initialTab 引用变化——连续两次齿轮打开时引用不变，需以 open 为触发。
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

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
    setFeedback({
      text: errorText(result.error.code, result.error.message, t),
      ...(result.error.message === undefined ? {} : { detail: result.error.message }),
    })
    return false
  }

  const tabs: Array<{ key: TabKey; label: string; icon?: JSX.Element; dividerBefore?: boolean }> = [
    { key: 'changes', label: t('center.changes') },
    { key: 'history', label: t('center.history') },
    { key: 'records', label: t('work.tab'), icon: <RecordIcon /> },
    // 偏好区：与功能 Tab 用发丝分隔线轻隔离（设置 = 非仓库操作）。
    { key: 'settings', label: t('settings.title'), icon: <GearIcon />, dividerBefore: true },
  ]

  /** Toast 通知通道：设置 Tab 的重置反馈等复用统一 toast。 */
  const notify = (text: string): void => setToast({ text, seq: Date.now() })

  /** 关闭:清空记录跳转请求,避免再次打开时残留定位。 */
  const closeCenter = (): void => {
    setRecordOpenRequest(null)
    setCommitRequest(null)
    onClose()
  }

  /** 顶栏右端的分支上下文胶囊：承接被移除标题行的分支信息（title 显示仓库根）。 */
  const branchLabel = snapshot.branch !== null ? snapshot.branch : `(${t('pill.detached')})`

  return (
    <Modal open={open} onClose={closeCenter} title={t('center.title')} closeLabel={t('center.close')} headless className="dsh-git-ui__center">
      <div style={css.centerShell}>
        {/* 顶栏 = 功能域：左 tab 组 + 右工具组（分支上下文 + 关闭），标题行已移除以让出内容区 */}
        <div style={css.topBar}>
          <div style={css.tabs} role="tablist">
            {tabs.map(({ key, label, icon, dividerBefore }) => (
              <Fragment key={key}>
                {dividerBefore === true && <span style={css.tabDivider} aria-hidden="true" />}
                <button
                  type="button"
                  role="tab"
                  id={`dsh-git-ui-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`dsh-git-ui-panel-${key}`}
                  className={`dsh-git-ui__tab${tab === key ? ' dsh-git-ui__tab--active' : ''}`}
                  style={tab === key ? { ...css.tab, ...css.tabActive } : css.tab}
                  onClick={() => setTab(key)}
                >
                  {icon !== undefined && <span style={css.tabIcon} aria-hidden="true">{icon}</span>}
                  {label}
                </button>
              </Fragment>
            ))}
          </div>
          <div style={css.tabsTrailing}>
            <span
              style={css.branchContextChip}
              title={snapshot.root}
              aria-label={`${t('center.currentBranch')}: ${branchLabel} · ${snapshot.root}`}
            >
              <span style={snapshot.dirty ? css.dotDirty : css.dot} aria-hidden="true" />
              <span style={css.branchContextName}>{branchLabel}</span>
            </span>
            <button
              type="button"
              className="dsh-git-ui__icon-btn"
              style={css.rowIconButton}
              title={t('center.close')}
              aria-label={t('center.close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div style={css.centerBody}>
          {feedback !== null && (
            <div style={css.feedbackError} role="alert" title={feedback.detail}>
              <span style={{ flex: 1 }}>{feedback.text}</span>
              <button type="button" style={css.feedbackClose} onClick={() => setFeedback(null)} aria-label={t('center.close')}>✕</button>
            </div>
          )}

          {/* 三标签保持挂载、display 切换：保留各自状态（选中/分页/分支列表），与 IDE 行为一致。 */}
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-changes"
            aria-labelledby="dsh-git-ui-tab-changes"
            style={tab === 'changes' ? { display: 'contents' } : { display: 'none' }}
          >
            <ChangesTab snapshot={snapshot} busy={busy} execute={execute} query={query} t={t} openRequest={recordOpenRequest ?? openRequest} />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-history"
            aria-labelledby="dsh-git-ui-tab-history"
            style={tab === 'history' ? { display: 'contents' } : { display: 'none' }}
          >
            <HistoryTab query={query} run={run} t={t} focusRef={commitRequest} />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-records"
            aria-labelledby="dsh-git-ui-tab-records"
            style={tab === 'records' ? { display: 'contents' } : { display: 'none' }}
          >
            <RecordsTab records={records} t={t}
              onOpenDiff={(path, base) => {
                setRecordOpenRequest({ path, base })
                setTab('changes')
              }}
              execute={execute}
              onOpenCommit={(hash) => {
                // nonce 保证重复点击同一提交也重触发定位(H8)。
                setCommitRequest({ hash, nonce: Date.now() })
                setTab('history')
              }}
              onReclassify={onReclassify}
            />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-settings"
            aria-labelledby="dsh-git-ui-tab-settings"
            style={tab === 'settings' ? { display: 'contents' } : { display: 'none' }}
          >
            <SettingsTab t={t} notify={notify} />
          </div>
        </div>
      </div>
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => setToast(null)} />
      )}
    </Modal>
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
  query, run, t, focusRef = null,
}: {
  query: GitCenterProps['query']
  run: GitCenterProps['run']
  t: (key: GitKey) => string
  /** 提交定位请求(记录页「已提交」条目深链):哈希前缀搜索 + 自动选中。
   * 对象态含 nonce——重复点击同一提交也产生新引用,重触发定位(H8)。 */
  focusRef?: { readonly hash: string; readonly nonce: number } | null
}): JSX.Element {
  const [commits, setCommits] = useState<readonly GraphCommit[]>([])
  /**
   * 窗口化渲染：固定行高（HISTORY_ROW_H=32），列表只挂载可视窗 ±overscan 的行，
   * 上下以垫片撑出滚动高度——历史与搜索结果的行数可到数千，全量渲染会拖垮
   * Web 端（本轮修复：加载 1000+/页 全量 DOM + 行入场动画 → 转圈/加载失败）。
   */
  const ROW_OVERSCAN = 10
  const [windowSlice, setWindowSlice] = useState({ start: 0, end: 60 })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<GraphCommit | null>(null)
  const [detail, setDetail] = useState<{ commit: GraphCommit; body: string; stats: readonly GitFileStat[] } | null>(null)
  /** 详情加载失败态(H3):show 查询失败/超时 — 不再永久「加载中」。 */
  const [detailError, setDetailError] = useState(false)
  /** 是否已到列表尽头(某页返回空/少于整页);未知 total 下的续载兜底(H4)。 */
  const [reachedEnd, setReachedEnd] = useState(false)
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
  /** 列表滚动容器与无限滚动状态。 */
  const listRef = useRef<HTMLDivElement>(null)
  /**
   * 过滤代(H1):每次过滤/搜索/深链变更 +1。在途响应对不上代即丢弃——
   * 旧数据不再冒充新过滤、不写脏缓存;新代请求直接接管(允许重叠,旧响应按代丢弃)。
   */
  const seqRef = useRef(0)
  /** 在途请求(代 + skip):同代单航防重复加载;新代接管时不阻塞。 */
  const inflight = useRef<{ seq: number; skip: number } | null>(null)
  /** 已展示列表所属代:skip>0 的滚动续载仅对当前代有效(防新旧过滤混合追加)。 */
  const loadedSeq = useRef(0)
  /** 选中哈希实时镜像(select 响应守卫,H2):晚到 show 响应不覆盖新选中。 */
  const selectedHash = useRef<string | null>(null)
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

  /** 是否还有更多:total 已知按长度比较;未知(-1)按「未达尽头」续载(H4——
   * 旧实现 rev-list 失败 total 恒 0,commits.length < 0 恒 false,哨兵消失冻结
   * 无限滚动)。reachedEnd 兜底:某页返回空/少于整页即停,即使 total 未知。 */
  const hasMore = total < 0 ? !reachedEnd : commits.length < total

  const loadPage = async (skip: number, f: { ref: string | null; search: string; author: string; since: string }): Promise<void> => {
    const seq = seqRef.current
    // 滚动续载仅对当前代有效(防新旧过滤按 skip 混合追加,剧本 A 第 4 步)。
    if (skip > 0 && seq !== loadedSeq.current) return
    // 同代单航防重复;新代请求直接接管(旧响应按代在下游丢弃)。
    const active = inflight.current
    if (active !== null && active.seq === seq) return
    inflight.current = { seq, skip }
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
    // 陈旧代响应:丢弃——不更新 state、不写缓存(剧本 A 第 3/5 步)。
    if (seq !== seqRef.current) {
      if (inflight.current?.seq === seq) inflight.current = null
      return
    }
    setLoading(false)
    if (inflight.current?.seq === seq) inflight.current = null
    if (!outcome.ok) return
    if (outcome.value.kind !== 'history') return
    const page = outcome.value.commits
    if (page.length < HISTORY_PAGE) setReachedEnd(true)
    const next = skip === 0 ? page : [...commits, ...page]
    setCommits(next)
    setTotal(outcome.value.total)
    if (skip === 0) loadedSeq.current = seq
    writeHistoryCache(f, next, outcome.value.total)
  }

  /** 无限滚动：接近底部 240px 自动加载下一批。 */
  const onScroll = (): void => {
    const el = listRef.current
    if (el === null) return
    // 窗口化渲染：只渲染可视窗 ±overscan 的行（固定行高），滚动时滑动窗口。
    const start = Math.max(0, Math.floor(el.scrollTop / css.HISTORY_ROW_H) - ROW_OVERSCAN)
    const end = Math.min(listRows.length, Math.ceil((el.scrollTop + el.clientHeight) / css.HISTORY_ROW_H) + ROW_OVERSCAN)
    setWindowSlice((w) => (w.start === start && w.end === end ? w : { start, end }))
    if (loading || !hasMore) return
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

  // 过滤变化：换代 + 缓存命中瞬显；不清空旧数据，新数据就位后整体替换旧行，避免空白“闪烁”。
  useEffect(() => {
    seqRef.current += 1
    const seq = seqRef.current
    setSelected(null)
    setDetail(null)
    setDetailError(false)
    selectedHash.current = null
    setReachedEnd(false)
    // 过滤切换：列表内容整体替换，滚动与窗口化切片归零。
    setWindowSlice({ start: 0, end: 60 })
    if (listRef.current !== null) listRef.current.scrollTop = 0
    const cached = historyCache.current.get(cacheKey(filter))
    if (cached !== undefined) {
      setCommits(cached.commits)
      setTotal(cached.total)
      loadedSeq.current = seq
      setReachedEnd(cached.total >= 0 && cached.commits.length >= cached.total)
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

  // 提交定位(深链):哈希前缀直达搜索(绕过防抖),结果就位后自动选中首个匹配。
  const pendingFocus = useRef<string | null>(null)
  /** 深链消费触发(H8):同哈希重复点击时 filter 未变,靠 nonce 驱动消费 effect。 */
  const [focusNonce, setFocusNonce] = useState(0)
  useEffect(() => {
    if (focusRef === null) return
    pendingFocus.current = focusRef.hash
    setSearchInput(focusRef.hash)
    setFocusNonce((n) => n + 1)
    setFilter((prev) => (prev.search === focusRef.hash ? prev : { ...prev, ref: null, search: focusRef.hash }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 深链请求一次一响应
  }, [focusRef])
  useEffect(() => {
    const target = pendingFocus.current
    if (target === null || loading || commits.length === 0) return
    const match = commits.find((commit) => commit.hash.startsWith(target))
    pendingFocus.current = null // 无论是否命中,一次定位请求只消费一次
    if (match !== undefined) void select(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 结果批就位后消费挂起定位
  }, [commits, loading, focusNonce])

  const select = useCallback(async (commit: GraphCommit): Promise<void> => {
    selectedHash.current = commit.hash
    setSelected(commit)
    setDetail(null)
    setDetailError(false)
    const outcome = await query({ kind: 'show', ref: commit.hash })
    // 响应守卫(H2):仅当本次点击仍是当前选中时落地——晚到响应不乱序覆盖(A→B 点选)。
    if (selectedHash.current !== commit.hash) return
    if (outcome.ok && outcome.value.kind === 'show' && outcome.value.commit !== null) {
      setDetail({ commit: outcome.value.commit as GraphCommit, body: outcome.value.body, stats: outcome.value.stats })
    } else {
      // 查询失败/超时:进入失败态,不再永久「加载中」(H3)。
      setDetailError(true)
    }
  }, [query])

  // 底部静置自动续载(H9):滚动条停在底部时不再依赖 onScroll,随批次/加载态
  // 自查补载;用户上滚后自然停止。
  useEffect(() => {
    const el = listRef.current
    if (el === null || loading || !hasMore) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) void loadPage(commits.length, filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 底部静置自动续载
  }, [commits, loading, hasMore])

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
            {listRows.length > 0 && (
              <>
                {/* 顶垫：撑出窗口前的高度（固定行高 × 行数），保持滚动条真实。 */}
                <div style={{ height: windowSlice.start * css.HISTORY_ROW_H, flexShrink: 0 }} aria-hidden="true" />
                {listRows.slice(windowSlice.start, windowSlice.end).map((row) => (
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
                {/* 底垫：窗口后剩余高度（列表可能在加载更多，底垫随行数增长自动扩展）。 */}
                <div style={{ height: Math.max(0, listRows.length - windowSlice.end) * css.HISTORY_ROW_H, flexShrink: 0 }} aria-hidden="true" />
              </>
            )}
            {hasMore && (
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
                  <div style={css.emptyState}>
                    <span style={css.emptyStateIcon} aria-hidden="true"><CommitIcon /></span>
                    {t('right.selectCommit')}
                  </div>
                  <div style={{ ...css.emptyState, ...css.rightEmptyZoneBottom }}>
                    <span style={css.emptyStateIcon} aria-hidden="true"><CommitIcon /></span>
                    {t('right.commitDetails')}
                  </div>
                </>
              )
              : (
                <>
                  <div style={{ ...css.rightFiles, flex: 'none', height: `${rightTopPct}%` }}>
                {detail === null
                  ? detailError
                    ? <div style={css.centeredEmpty}>{t('history.detailFailed')}</div>
                    : <div style={css.centeredEmpty}>{t('center.loading')}</div>
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
                      <div style={css.commitDetailMetaRow}>
                        <span style={css.commitDetailHash}>{selected.shortHash}</span>
                        <span style={css.commitDetailMeta}>{selected.author}</span>
                        <span style={css.commitDot}>·</span>
                        <span style={css.commitDetailMeta}>{timeAgo(selected.dateIso, now, t)}</span>
                      </div>
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
        style={{ ...(active ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow), paddingLeft: indent, paddingTop: 3, paddingBottom: 3 }}
        onClick={() => onFilter({ kind: 'ref', name })}
        title={name}
      >
        <span style={face.color === undefined ? css.treeIcon : { ...css.treeIcon, color: face.color }} aria-hidden="true">{face.icon}</span>
        <span style={mark ? { ...css.treeName, ...css.treeNameCurrent } : css.treeName}>{highlight(bare)}</span>
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
  // 本地分支：无斜杠直接平铺；带斜杠按第一段前缀聚合为可折叠文件夹（IDEA 式）。
  const localRoots: GitBranch[] = []
  const localFolders: Array<[string, readonly GitBranch[]]> = []
  if (tree !== null) {
    const map = new Map<string, GitBranch[]>()
    for (const b of tree.local) {
      const slash = b.name.indexOf('/')
      if (slash === -1) {
        localRoots.push(b)
        continue
      }
      const group = b.name.slice(0, slash)
      const list = map.get(group)
      if (list === undefined) map.set(group, [b])
      else list.push(b)
    }
    localFolders.push(...map.entries())
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
            {tree.local.length > 0 && sectionHead('local', t('center.localBranches'))}
            {!closed.has('local') && localRoots.map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24, b))}
            {!closed.has('local') && localFolders.map(([group, branches]) => (
              <div key={`g-${group}`}>
                <button
                  type="button"
                  className="dsh-git-ui__row"
                  style={{ ...css.treeRow, paddingLeft: 24 }}
                  onClick={() => onToggleSection(`local:${group}`)}
                  aria-expanded={!closed.has(`local:${group}`)}
                >
                  <span style={css.treeCaret}><ChevronIcon open={!closed.has(`local:${group}`)} /></span>
                  <span style={css.treeFolderIcon}><FolderIcon /></span>
                  <span style={css.treeName}>{group}</span>
                </button>
                {!closed.has(`local:${group}`) && branches.map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 44, b))}
              </div>
            ))}
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


// ── 提交行（memo）与自绘下拉 ────────────────────────────────────────

/** 搜索条目装饰圆点取色：提交稳定散列色（复用分支图色板与 colorOf）。 */
function dotColorOf(hash: string): string {
  return colorOf(hash)
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
  const isMerge = row.commit.parents.length > 1
  return (
    <button
      type="button"
      className="dsh-git-ui__commit-row"
      aria-current={isSelected ? 'true' : undefined}
      style={{
        ...(isSelected ? { ...css.historyRow, ...css.historyRowSelected } : css.historyRow),
        gridTemplateColumns: gridTpl,
      }}
      onClick={() => onSelect(row.commit)}
    >
      {showGraph ? (
        <GraphStrip row={row} cols={cols} laneW={laneW} endOpen={row.endOpen} selected={isSelected} />
      ) : (
        <span style={css.searchDot} aria-hidden="true">
          <span
            style={{
              ...css.searchDotInner,
              background: dotColorOf(row.commit.hash),
              ...(isSelected ? { boxShadow: '0 0 0 2px var(--dsw-alias-state-business-primary)' } : {}),
            }}
          />
        </span>
      )}
      <span style={css.historySubjectCell}>
        <RefPills refs={row.commit.refs} />
        {/* IDEA 式：merge 提交（多父）主题弱化——不喧宾夺主，与普通提交区分。 */}
        <span style={isMerge ? { ...css.commitSubjectLine, ...css.commitSubjectMerge } : css.commitSubjectLine} title={row.commit.subject}>
          {row.commit.subject}
        </span>
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
 *
 * 颜色（IDEA 式）：由 git-graph 算法随行交付的 `lineColors`/`nodeColor`——
 * 每条线 = 其源分支链色（同链恒一色，跨行同色延续；汇聚线保持各自子链色）。
 * 线条等权细线（1.5px 全色，无分层透明度）——IDEA 日志图的统一权重语汇。
 * 选中行：节点外接 business 色细环，与右侧详情面板锚定联动。
 */
function GraphStrip({
  row, cols, laneW, endOpen, selected,
}: {
  row: GraphRowMarker
  cols: number
  laneW: number
  endOpen?: boolean
  selected?: boolean
}): JSX.Element {
  const w = Math.max(cols, 1) * laneW
  const h = css.HISTORY_ROW_H
  const x = (col: number): number => col * laneW + laneW / 2
  const cy = h / 2
  const nodeR = Math.max(GRAPH_NODE_MIN_R, Math.min(GRAPH_NODE_R, laneW / 3))
  /** 车道线色：行内解析色优先，缺失回退车道索引色（兼容旧数据）。 */
  const colorOfLane = (col: number): string => row.lineColors?.[col] ?? GRAPH_COLORS[col % GRAPH_COLORS.length]!
  /** 节点色：所在链色（行内已解析；回退车道索引色）。 */
  const nodeColor = row.nodeColor ?? colorOfLane(row.column)
  return (
    // overflow visible：选中环（r+3）在极窄车道（laneW=8 的 24+ 列图）下会超出
    // SVG 边界——放行视觉溢出（display:block 不影响布局，仅选中行绘环）。
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0, overflow: 'visible' }} aria-hidden="true">
      {row.verticals.map((col) => (
        // openLanes(H6):merge 副父等非节点延续线在过滤下贯到图尾未解析——
        // 末行以虚线 + 端止横杠标示(与 endOpen 诚实提示一致)。
        row.openLanes?.includes(col) === true
          ? (
            <g key={`v-${col}`}>
              <line x1={x(col)} y1={0} x2={x(col)} y2={h - 5} stroke={colorOfLane(col)} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
              <line x1={x(col) - 4} y1={h - 5} x2={x(col) + 4} y2={h - 5} stroke={colorOfLane(col)} strokeWidth={1.5} strokeLinecap="round" />
            </g>
          )
          : (
            <line key={`v-${col}`} x1={x(col)} y1={0} x2={x(col)} y2={h} stroke={colorOfLane(col)} strokeWidth={1.5} strokeLinecap="round" />
          )
      ))}
      {row.nodeFromTop && (
        // 来线段：上游链色（分支起点行的来线保持上游色，与上行延续线连续）。
        <line x1={x(row.column)} y1={0} x2={x(row.column)} y2={cy} stroke={row.incomingColor ?? colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      )}
      {row.joins.map((join) => (
        <g key={`j-${join}`}>
          {/* 汇聚车道：各自子链色自上方竖线到节点高度，再水平连接线汇入节点（锚定父节点行）。 */}
          <line x1={x(join)} y1={0} x2={x(join)} y2={cy} stroke={colorOfLane(join)} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={x(join)} y1={cy} x2={x(row.column)} y2={cy} stroke={colorOfLane(join)} strokeWidth={1.5} strokeLinecap="round" />
        </g>
      ))}
      {row.nodeContinues && (endOpen === true ? (
        <>
          {/* 悬垂端头：父提交不在已加载集合（被过滤/边界），虚线 + 端止横杠，诚实提示上游未载入。 */}
          <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h - 5} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
          <line x1={x(row.column) - 4} y1={h - 5} x2={x(row.column) + 4} y2={h - 5} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
        </>
      ) : (
        <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      ))}
      {row.edges.map((edge, i) => (
        <path
          key={`e-${i}`}
          // 曲线控制点 0.4/0.6 交错：起段微陡、中段平缓、收段回陡——比中点控制更圆润的曲线。
          // 颜色 = merge 链色（曲线是 merge 节点发出的；不随目标车道色——octopus 复用
          // 车道时目标线保持其源链色，曲线独立于车道线）。
          d={`M ${x(edge.from)} ${cy} C ${x(edge.from)} ${cy + (h - cy) * 0.4}, ${x(edge.to)} ${cy + (h - cy) * 0.6}, ${x(edge.to)} ${h}`}
          fill="none"
          stroke={nodeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* 选中环：business 色细环 + 节点色核心，与右侧详情面板联动锚定。 */}
      {selected === true && (
        <circle
          cx={x(row.column)}
          cy={cy}
          r={nodeR + 3}
          fill="none"
          stroke="var(--dsw-alias-state-business-primary)"
          strokeWidth={1.5}
        />
      )}
      <circle
        cx={x(row.column)}
        cy={cy}
        r={nodeR}
        fill={nodeColor}
        stroke="var(--dsw-alias-bg-layer-2)"
        strokeWidth={1.5}
      />
    </svg>
  )
}
