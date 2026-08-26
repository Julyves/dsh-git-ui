import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitBranch, GitFileStat, GraphCommit } from '../../../host/types.ts'
import { createColorAllocator, createGraphBuilder, createTipAwareColorOf, graphWidth, markFilterEnds, type GraphRow, type GraphRowMarker } from '../../git-graph.ts'
import { buildFileTree, type FileTreeNode } from '../../file-tree.ts'
import { CollapseAllIcon, CommitIcon, ExpandAllIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import { SelectMenu } from '../../select-menu.tsx'
import * as css from '../../styles.ts'
import { Splitter } from '../Splitter.tsx'
import { clampNum, timeAgo, HISTORY_PAGE, GRAPH_COL_W, GRAPH_MAX_TRACK_W, GRAPH_LANE_MIN_W } from '../shared.ts'
import type { GitCenterProps } from '../shared.ts'
import { HistoryFilterTree } from './HistoryFilterTree.tsx'
import { FileTreeNodes } from './FileTreeNodes.tsx'
import { CommitRow } from './CommitRow.tsx'

export function HistoryTab({
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
  /**
   * 分支名避撞分配器：tree 加载后用全量分支名做确定性避撞，减少同色碰撞（IDEA 式可读性）。
   *
   * 并包装「分支 tip 锚定」（createTipAwareColorOf）：merge 行处理第二父时，被合并分支
   * tip 尚未进入已处理序列（拓扑序父在后），其链色未解析，车道线色回退到
   * colorOfFn(parentHash) 的 hash 散列色——与该分支锚定色脱节，甚至撞上合并目标分支色
   * （「弯折段提前染目标色」的残留根因）。用 tree.local 的 shortHash 映射，让兜底取到
   * 被合并分支锚定色，与该分支自身行同色（无跳变）。
   */
  const graphColorOf = useMemo(
    () => createTipAwareColorOf(
      createColorAllocator(tree ? [...tree.local, ...tree.remote, ...tree.tags].map((b) => b.name) : []),
      tree ? tree.local.flatMap((b) => (b.shortHash ? [[b.shortHash, b.name] as const] : [])) : [],
    ),
    [tree],
  )
  const builderRef = useRef(createGraphBuilder(graphColorOf))
  const prevCommitsRef = useRef<readonly GraphCommit[]>([])
  /** 上一个 builder 实际使用的 colorOfFn：引用变化（tree 到达→分配器/tip 映射就绪）须整体重建，
   * 否则增量 append 仍走旧 builder 的空分配器——避撞与 tip 锚定均不生效（时序缺陷修复）。 */
  const builderColorRef = useRef(graphColorOf)
  const [graphRows, setGraphRows] = useState<readonly GraphRow[]>([])
  useEffect(() => {
    if (searching) {
      builderRef.current = createGraphBuilder(graphColorOf)
      builderColorRef.current = graphColorOf
      prevCommitsRef.current = commits
      setGraphRows([])
      return
    }
    const colorChanged = builderColorRef.current !== graphColorOf
    const prev = prevCommitsRef.current
    // 增量扩展仅当 builder 持有的 colorOfFn 未变且列表确为前缀扩展时成立。
    const isExtension = !colorChanged && prev.length <= commits.length && prev.every((c, i) => c.hash === commits[i]?.hash)
    if (!isExtension) {
      builderRef.current = createGraphBuilder(graphColorOf)
      builderColorRef.current = graphColorOf
      setGraphRows(builderRef.current.append(commits))
    } else if (commits.length > prev.length) {
      const newRows = builderRef.current.append(commits.slice(prev.length))
      if (newRows.length > 0) setGraphRows((existing) => [...existing, ...newRows])
    }
    prevCommitsRef.current = commits
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 随提交集合/搜索态/避撞分配器变化喂入 builder
  }, [commits, searching, graphColorOf])

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
