/**
 * Git 分支图数据模型与车道生命周期列分配算法。
 *
 * 输入为 `git log --all` 拓扑序（新→旧）的 `GraphCommit[]`。本模块维护一组
 * “车道”（lane）：每条车道等待下一个应出现的提交（waiting-for）。提交到达时：
 *   - 等待该提交的所有车道中，首个承载节点，其余（`joins`）在本行经水平连接线
 *     汇入节点——**多子汇向同一父的汇聚锚定在父节点行**（IDEA 式分叉/汇聚）；
 *   - 首父继承当前车道（直线延续）；
 *   - 第二及更多父提交复用已等待它的车道，否则开辟新车道，均产生分裂曲线；
 *   - 释放的车道按索引回收，列数贴近历史真实并发度，永不单调增长。
 *
 * 颜色语义（IDEA 式「一条分支链恒一色」，修复「每提交一色 → 彩虹链」）：
 *   - 车道携带 `owner`（该线归属的源提交）：线条颜色 = 其 owner 所在链的颜色，
 *     因此同一条可见长线跨行颜色恒定、且恒为其源分支色；
 *   - 链色规则：提交自身带本地分支/HEAD 引用 → `colorOf(分支名)`（分支起点色）；
 *     否则继承「等待该提交的首个车道 owner（子）」的链色（子先处理，链向下延续；
 *     多子异色时以先处理者（更低车道索引）为依据——确定性启发式，非语义主干）；
 *     无等待者（无名根/tip）→ `colorOf(hash)` 兜底。
 *   - 节点 = 所在链色；汇聚线各自保持**子链色**汇入（IDEA 丰富度）；
 *     merge 分裂曲线 = merge 链色（曲线是 merge 节点发出的，不随目标车道——
 *     octopus merge 复用车道时目标线保持其源链色，两者互不染指）。
 *   - 每行解析完毕的最终色随 `lineColors`/`nodeColor`/`incomingColor` 存入行
 *     ——渲染零上下文、纯数据可测、增量追加安全（已渲染行颜色永不变）。
 *
 * 渲染契约（与行样式共用单一事实来源）：行高固定、条带占满整行，
 * 竖线在行间自然衔接；分裂用贝塞尔曲线，汇聚用水平连接线。
 *
 * 不依赖 React，可纯单元测试。
 */
import type { GraphCommit } from '../host/types.ts'

/** 渲染一行所需的全部几何信息（对应一个提交）。 */
export interface GraphRow {
  readonly commit: GraphCommit
  /** 节点所在的 0 基列号。 */
  readonly column: number
  /** 贯穿整行（0→行高）的竖线车道：处理本行前后均活跃的车道。 */
  readonly verticals: readonly number[]
  /** 自上方来、本行汇入节点后关闭的车道：画竖线到节点高度 + 水平连接线入节点。 */
  readonly joins: readonly number[]
  /** 节点车道在本行之前已存在：自行顶到节点画半段竖线。 */
  readonly nodeFromTop: boolean
  /** 节点车道在本行之后延续：自节点到行底画半段竖线。 */
  readonly nodeContinues: boolean
  /** 自节点向下的分裂曲线（merge 的第二父 fan-out），终点在行底的目标车道。 */
  readonly edges: readonly GraphEdge[]
  /**
   * 每车道的「来源提交」（可选）：该线归属的源提交 hash——链色判定依据
   * （贯穿线=车道 owner；节点列=当前提交；edges 目标=merge 提交）。
   * 缺失时渲染层回退车道索引色。
   */
  readonly laneHashes?: Readonly<Record<number, string>>
  /** 每车道最终色（可选）：随行交付的解析色，渲染零上下文。 */
  readonly lineColors?: Readonly<Record<number, string>>
  /**
   * 每车道的链身份锚点（可选）：该线归属链的起始 hash——悬停高亮/折叠定位
   * 链的稳定身份（owner 是段级、每行重写，anchor 跨行恒定标识一条链）。
   */
  readonly laneAnchors?: Readonly<Record<number, string>>
  /** 节点最终色（可选）：所在链色。 */
  readonly nodeColor?: string
  /** 节点链锚点（可选）：悬停高亮定位节点所在链。 */
  readonly nodeAnchor?: string
  /**
   * 上方来线段最终色（可选）：分支起点行的「来线」保持上游链色（IDEA 分叉
   * 视觉）——与 nodeContinues 延续线的当前链色并存。无来线时缺省。
   */
  readonly incomingColor?: string
}

/** 一条分裂曲线（merge 节点 → 第二父车道，着 merge 链色）。 */
export interface GraphEdge {
  readonly from: number
  readonly to: number
}

/**
 * 车道语义调色板（IDEA 式）：24 色 CSS 变量——色相均匀分布（红→橙→黄→绿→
 * 青→蓝→紫轮转）、饱和 50-60%、明度 45-55%，亮暗主题双满足。变量值由
 * styles/globals.ts 注入亮/暗两套 `--dsg-graph-*`；SVG stroke attribute
 * 直接用 var()（现代引擎解析），主题切换零 JS 重渲染。
 */
export const GRAPH_COLORS: readonly string[] = [
  'var(--dsg-graph-0)', 'var(--dsg-graph-1)', 'var(--dsg-graph-2)',
  'var(--dsg-graph-3)', 'var(--dsg-graph-4)', 'var(--dsg-graph-5)',
  'var(--dsg-graph-6)', 'var(--dsg-graph-7)', 'var(--dsg-graph-8)',
  'var(--dsg-graph-9)', 'var(--dsg-graph-10)', 'var(--dsg-graph-11)',
  'var(--dsg-graph-12)', 'var(--dsg-graph-13)', 'var(--dsg-graph-14)',
  'var(--dsg-graph-15)', 'var(--dsg-graph-16)', 'var(--dsg-graph-17)',
  'var(--dsg-graph-18)', 'var(--dsg-graph-19)', 'var(--dsg-graph-20)',
  'var(--dsg-graph-21)', 'var(--dsg-graph-22)', 'var(--dsg-graph-23)',
]

/** 调色板大小（供避撞分配判断耗尽）。 */
export const GRAPH_PALETTE_SIZE = GRAPH_COLORS.length

/** 稳定的散列色：字符串字符累加取模色板（同一分支名/提交永远同色）。 */
export function colorOf(key: string): string {
  return GRAPH_COLORS[hashKey(key) % GRAPH_PALETTE_SIZE]!
}

/** 字符串散列（charCode 累加），供 colorOf 与避撞分配器共用。 */
function hashKey(key: string): number {
  let sum = 0
  for (let i = 0; i < key.length; i += 1) sum += key.charCodeAt(i)
  return sum
}

/**
 * 贪心避撞分配器：对已知分支名做确定性避撞（按名排序后，每个分配首个未占用色，
 * 优先尝试 hash 色、被占则顺延），调色板耗尽后回落 hash（允许碰撞）。
 * 未知 key 回落 colorOf（hash）——提交 hash 等无避撞需求的兜底。
 *
 * 用途：HistoryTab 用 branches/tags 查询喂全量分支名，构造分配器传给
 * createGraphBuilder，使同图内的分支名尽量不撞色（IDEA 式可读性）。
 */
export function createColorAllocator(knownNames: readonly string[]): (key: string) => string {
  const used = new Set<number>()
  const assignment = new Map<string, number>()
  for (const name of [...new Set(knownNames)].sort()) {
    const hashIdx = ((hashKey(name) % GRAPH_PALETTE_SIZE) + GRAPH_PALETTE_SIZE) % GRAPH_PALETTE_SIZE
    let idx = hashIdx
    while (used.has(idx)) {
      idx = (idx + 1) % GRAPH_PALETTE_SIZE
      if (idx === hashIdx) break // 一轮无空色，耗尽
    }
    if (used.size < GRAPH_PALETTE_SIZE) {
      assignment.set(name, idx)
      used.add(idx)
    }
    // 耗尽：不记入 assignment，回落 colorOf（hash）
  }
  return (key: string): string => {
    const idx = assignment.get(key)
    return idx !== undefined ? GRAPH_COLORS[idx]! : colorOf(key)
  }
}

/** 车道条目的身份：等待的目标 + 归属来源（线色判定键）。 */
interface LaneEntry {
  /** 该车道等待的提交 hash。 */
  readonly wait: string
  /** 该线的来源提交 hash：颜色 = 其链色。 */
  readonly owner: string
}

/** 回收第一个空闲车道索引并登记为本行新开；无空闲则扩容。 */
function openLane(lanes: (LaneEntry | null)[], opened: Set<number>): number {
  const index = lanes.indexOf(null)
  const lane = index === -1 ? (lanes.push(null), lanes.length - 1) : index
  opened.add(lane)
  return lane
}

/** 链色解析结果：颜色 + 链身份锚点（随继承传播，供悬停高亮/折叠定位链）。 */
interface ChainColor {
  readonly color: string
  /** 链身份锚点：链起始处带 ref 的提交 hash（或自身兜底）。随继承传播。 */
  readonly anchor: string
}

/**
 * 解析一个提交的链色（IDEA 规则）：
 *   1. 自身带分支引用（本地分支/HEAD）→ 该分支名散列色（分支起点，全链锚定色），anchor=自身；
 *   2. 否则继承「等待它的首个车道 owner（子）」的链色与 anchor（子先处理、已解析）；
 *   3. 无等待者（无名根/尖端）→ 该提交 hash 散列色，anchor=自身。
 */
function resolveChainColor(
  commit: GraphCommit,
  waitingOwners: readonly string[],
  memo: Map<string, ChainColor>,
  colorOfFn: (key: string) => string,
): ChainColor {
  const cached = memo.get(commit.hash)
  if (cached !== undefined) return cached
  // 分支名锚定：本地分支（含 HEAD -> 装饰解析出的 head 分支）；远程/标签不定义链色。
  const branchRef = commit.refs.find((ref) => ref.kind === 'branch')
  if (branchRef !== undefined) {
    const resolved: ChainColor = { color: colorOfFn(branchRef.name), anchor: commit.hash }
    memo.set(commit.hash, resolved)
    return resolved
  }
  // 子链继承：首个等待者（先到的子车道）的链色与 anchor。
  for (const owner of waitingOwners) {
    const inherited = memo.get(owner)
    if (inherited !== undefined) {
      memo.set(commit.hash, inherited)
      return inherited
    }
  }
  const resolved: ChainColor = { color: colorOfFn(commit.hash), anchor: commit.hash }
  memo.set(commit.hash, resolved)
  return resolved
}

/** 处理单个提交：更新车道并产出该行几何与最终色（buildGraph 与增量 builder 共用同一循环体）。 */
function processCommit(
  commit: GraphCommit,
  lanes: (LaneEntry | null)[],
  memo: Map<string, ChainColor>,
  colorOfFn: (key: string) => string,
): GraphRow {
  const opened = new Set<number>()
  // 车道身份快照（在清空/改写前记录）：每条线的颜色 = 其 owner 的链色。
  const laneHashes: Record<number, string> = {}
  const laneAnchors: Record<number, string> = {}
  lanes.forEach((entry, index) => {
    if (entry !== null) laneHashes[index] = entry.owner
  })
  // 1. 节点列：等待该提交的所有车道（分叉多子各占一条）中首个；否则新开车道（分支尖端）。
  //    其余等待车道记入 `joins`——本行经「竖线→水平连接线→节点」汇入（锚定父节点行）。
  const waiting: number[] = []
  lanes.forEach((entry, index) => {
    if (entry !== null && entry.wait === commit.hash) waiting.push(index)
  })
  const waitingOwners = waiting.map((index) => lanes[index]!.owner)
  const column = waiting.length > 0 ? waiting[0]! : openLane(lanes, opened)
  const nodeFromTop = waiting.length > 0
  const joins = waiting.slice(1)
  for (const index of waiting) lanes[index] = null

  // 2. 首父：本车道直线延续（新模型不提前回归——汇聚由父节点行的 joins 表达）。
  const edges: GraphEdge[] = []
  const firstParent = commit.parents[0]
  let nodeContinues = false
  if (firstParent !== undefined) {
    lanes[column] = { wait: firstParent, owner: commit.hash }
    nodeContinues = true
    laneHashes[column] = commit.hash
  } else {
    laneHashes[column] = commit.hash
  }

  // 3. 第二及更多父提交：复用已等待它的车道，否则开辟新车道；均记分裂曲线。
  //    owner = parentHash（第二父自身）——被合并分支染源色而非 merge 链色（IDEA 语义）：
  //    第二父链色独立解析（带源分支 ref 则锚定源色，否则 hash 兜底），不染 merge 色。
  for (let p = 1; p < commit.parents.length; p += 1) {
    const parentHash = commit.parents[p]!
    let target = lanes.findIndex((entry) => entry !== null && entry.wait === parentHash)
    if (target === -1) {
      target = openLane(lanes, opened)
      lanes[target] = { wait: parentHash, owner: parentHash }
      laneHashes[target] = parentHash
    }
    edges.push({ from: column, to: target })
  }

  // 4. 贯穿竖线：处理后仍在等待的车道；节点列、本行新开、本行汇入(joins)的车道除外。
  const excluded = new Set<number>(joins)
  excluded.add(column)
  const verticals: number[] = []
  lanes.forEach((entry, index) => {
    if (entry === null || excluded.has(index) || opened.has(index)) return
    verticals.push(index)
    laneHashes[index] = entry.owner
  })

  // 5. 链色解析：节点 = 当前提交链色；各线 = 其 owner 的链色（子先处理、已解析）。
  //    节点列两段线需并行：上方来线段（若存在）= 上游链色（incomingColor，分支起点
  //    视觉：节点 = 新链色、来线 = 上游链色）；延续线段 = 当前链色（lineColors[column]）。
  const resolved = resolveChainColor(commit, waitingOwners, memo, colorOfFn)
  const nodeColor = resolved.color
  const nodeAnchor = resolved.anchor
  const lineColors: Record<number, string> = {}
  for (const [laneKey, owner] of Object.entries(laneHashes) as [string, string][]) {
    const chain = memo.get(owner)
    lineColors[Number(laneKey)] = chain?.color ?? colorOfFn(owner)
    laneAnchors[Number(laneKey)] = chain?.anchor ?? owner
  }
  lineColors[column] = nodeColor
  laneAnchors[column] = nodeAnchor
  const incomingChain = waiting.length > 0 ? memo.get(waitingOwners[0]!) : undefined
  const incomingColor = incomingChain?.color ?? (waiting.length > 0 ? colorOfFn(waitingOwners[0]!) : undefined)

  return {
    commit, column, verticals, joins, nodeFromTop, nodeContinues, edges,
    laneHashes, laneAnchors, lineColors, nodeColor, nodeAnchor,
    ...(incomingColor === undefined ? {} : { incomingColor }),
  }
}

/**
 * 增量图构建器：持有车道末态，`append` 只处理新增提交并返回新增行。
 * 既有行对象保持同一引用——配合 CommitRow 的 React.memo，避免逐批追加时全表重渲染，
 * 也免除每次滚动对全部已加载提交的 O(n·车道) 全量重算。
 * 集合被整体替换（过滤切换/缓存恢复）时请新建 builder 并从零 `append`。
 */
export interface GraphBuilder {
  /** 已处理提交总数。 */
  readonly count: number
  /** 追加一批新提交（不得重复传入已处理过的提交），返回这批新增的行。 */
  append(commits: readonly GraphCommit[]): readonly GraphRow[]
}

export function createGraphBuilder(colorOfFn: (key: string) => string = colorOf): GraphBuilder {
  const lanes: (LaneEntry | null)[] = []
  const memo = new Map<string, ChainColor>()
  let count = 0
  return {
    get count() {
      return count
    },
    append(commits) {
      const rows: GraphRow[] = []
      for (const commit of commits) {
        rows.push(processCommit(commit, lanes, memo, colorOfFn))
        count += 1
      }
      return rows
    },
  }
}

/** 一次性图构建：等价于 `createGraphBuilder(colorOfFn).append(commits)`。 */
export function buildGraph(commits: readonly GraphCommit[], colorOfFn: (key: string) => string = colorOf): readonly GraphRow[] {
  return createGraphBuilder(colorOfFn).append(commits)
}

/** 图宽度（车道数）：所有行涉及的最大列号 + 1；空图为 0。循环求值，避免大数组展开。 */
export function graphWidth(rows: readonly GraphRow[]): number {
  let width = 0
  const consider = (col: number): void => {
    if (col + 1 > width) width = col + 1
  }
  for (const row of rows) {
    consider(row.column)
    for (const col of row.verticals) consider(col)
    for (const join of row.joins) consider(join)
    for (const edge of row.edges) consider(edge.to)
  }
  return width
}

/** 带悬垂标记的行：`endOpen` 表示延续线指向的父提交不在已加载集合（图上会悬垂）；
 * `openLanes` 表示 merge 副父等**非节点延续线**中延续到图尾仍未被解析的车道列
 * ——被过滤排除的父提交对应的等待车道,以虚线+端止横杠标示(H6)。 */
export interface GraphRowMarker extends GraphRow {
  readonly endOpen?: boolean
  readonly openLanes?: readonly number[]
}

/**
 * 标记「延续线指向的父提交不在已加载集合」的行——图上的悬垂竖线。
 *
 * 过滤（搜索/作者/日期）下结果集不含某些提交的父节点，`buildGraph` 的车道
 * 永远等不到父：`nodeContinues` 的延续线永久悬垂（endOpen）；merge 第二父等
 * 副父车道同理——若「最后的加载行」仍在等待该车道,则该车道从首次出现贯到
 * 图尾未解析 → 标记 openLanes(虚线+横杠)。判据:车道出现在**最后一行**的
 * verticals 中(父若已载入,车道必然在其节点行被消费,早于图尾消失)。
 * 分页边界同理但随下页加载消散;`filtered` 为 false 时不标记,让边界悬垂自愈。
 * 纯函数，可单测。
 */
export function markFilterEnds(
  rows: readonly GraphRow[],
  loadedHashes: ReadonlySet<string>,
  filtered: boolean,
): readonly GraphRowMarker[] {
  if (!filtered) return rows as readonly GraphRowMarker[]
  if (rows.length === 0) return []
  const lastIndex = rows.length - 1
  return rows.map((row, index): GraphRowMarker => {
    let marker: GraphRowMarker = row
    if (row.nodeContinues) {
      const parent = row.commit.parents[0]
      if (parent !== undefined && !loadedHashes.has(parent)) {
        marker = { ...marker, endOpen: true }
      }
    }
    // 末行(图尾)的 verticals = 等待的父提交不在已加载集合的车道(若父在更后
    // 行载入,该行必以 column/join 消费而非 verticals 延续)——全部标为悬垂。
    // 非末行的延续线保持实线,视觉上「贯到图尾再收端」(H6:merge 副父一致提示)。
    if (index === lastIndex && row.verticals.length > 0) {
      marker = { ...marker, openLanes: row.verticals }
    }
    return marker
  })
}
