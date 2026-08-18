/**
 * Git 分支图数据模型与车道生命周期列分配算法。
 *
 * 输入为 `git log --all` 拓扑序（新→旧）的 `GraphCommit[]`。本模块维护一组
 * “车道”（lane）：每条车道等待下一个应出现的提交（waiting-for）。提交到达时：
 *   - 等待该提交的所有车道中，首个承载节点，其余（`joins`）在本行经水平连接线
 *     汇入节点——**多子汇向同一父的汇聚锚定在父节点行**（IDEA 式分叉/汇聚，
 *     不再提前回归，修复原「return 曲线在父节点上方一行拐弯」的视觉偏移）；
 *   - 首父继承当前车道（直线延续）；
 *   - 第二及更多父提交复用已等待它的车道，否则开辟新车道，均产生分裂曲线；
 *   - 释放的车道按索引回收，列数贴近历史真实并发度，永不单调增长。
 *
 * 一个哈希可同时被多条车道等待（分叉的多个子提交各占一条）；该提交出现时
 * 全部收敛：节点落在首条车道，其余车道画「竖线→水平连接→节点」。
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
}

/** 一条分裂曲线（merge 节点 → 第二父车道，着目标车道色）。 */
export interface GraphEdge {
  readonly from: number
  readonly to: number
}

/**
 * 车道列的语义调色板（明暗主题下均有足够对比度），16 色循环。
 * 分支身份色与主题解耦是有意为之（与 IDEA 一致的固定车道配色）。
 */
export const GRAPH_COLORS: readonly string[] = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#E11D48',
  '#0EA5E9', '#A855F7', '#22C55E', '#F43F5E',
]

/** 回收第一个空闲车道索引；无空闲则扩容。 */
function freeLane(lanes: (string | null)[], opened: Set<number>): number {
  const index = lanes.indexOf(null)
  const lane = index === -1 ? (lanes.push(null), lanes.length - 1) : index
  opened.add(lane)
  return lane
}

/** 处理单个提交：更新车道并产出该行几何（buildGraph 与增量 builder 共用同一循环体）。 */
function processCommit(commit: GraphCommit, lanes: (string | null)[]): GraphRow {
  const opened = new Set<number>()
  // 1. 节点列：等待该提交的所有车道（分叉多子各占一条）中首个；否则新开车道（分支尖端）。
  //    其余等待车道记入 `joins`——本行经「竖线→水平连接线→节点」汇入（锚定父节点行）。
  const waiting: number[] = []
  lanes.forEach((waitingHash, index) => {
    if (waitingHash === commit.hash) waiting.push(index)
  })
  const column = waiting.length > 0 ? waiting[0]! : freeLane(lanes, opened)
  const nodeFromTop = waiting.length > 0
  const joins = waiting.slice(1)
  for (const index of waiting) lanes[index] = null

  // 2. 首父：本车道直线延续（新模型不提前回归——汇聚由父节点行的 joins 表达）。
  const edges: GraphEdge[] = []
  const firstParent = commit.parents[0]
  let nodeContinues = false
  if (firstParent !== undefined) {
    lanes[column] = firstParent
    nodeContinues = true
  }

  // 3. 第二及更多父提交：复用已等待它的车道，否则开辟新车道；均记分裂曲线。
  for (let p = 1; p < commit.parents.length; p += 1) {
    const parentHash = commit.parents[p]!
    let target = lanes.indexOf(parentHash)
    if (target === -1) {
      target = freeLane(lanes, opened)
      lanes[target] = parentHash
    }
    edges.push({ from: column, to: target })
  }

  // 4. 贯穿竖线：处理后仍在等待的车道；节点列、本行新开、本行汇入(joins)的车道除外。
  const excluded = new Set<number>(joins)
  excluded.add(column)
  const verticals: number[] = []
  lanes.forEach((waitingHash, index) => {
    if (waitingHash === null || excluded.has(index) || opened.has(index)) return
    verticals.push(index)
  })

  return { commit, column, verticals, joins, nodeFromTop, nodeContinues, edges }
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

export function createGraphBuilder(): GraphBuilder {
  const lanes: (string | null)[] = []
  let count = 0
  return {
    get count() {
      return count
    },
    append(commits) {
      const rows: GraphRow[] = []
      for (const commit of commits) {
        rows.push(processCommit(commit, lanes))
        count += 1
      }
      return rows
    },
  }
}

/** 一次性图构建：等价于 `createGraphBuilder().append(commits)`。 */
export function buildGraph(commits: readonly GraphCommit[]): readonly GraphRow[] {
  return createGraphBuilder().append(commits)
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

/** 带悬垂标记的行：`endOpen` 表示延续线指向的父提交不在已加载集合（图上会悬垂）。 */
export interface GraphRowMarker extends GraphRow {
  readonly endOpen?: boolean
}

/**
 * 标记「延续线指向的父提交不在已加载集合」的行——图上的悬垂竖线。
 *
 * 过滤（搜索/作者/日期）下结果集不含某些提交的父节点，`buildGraph` 的车道
 * 永远等不到父，`nodeContinues` 的延续线会永久悬垂；分页边界同理但随下页
 * 加载消散。`filtered` 为 false 时不标记，让边界悬垂随下页自愈。
 * 纯函数，可单测。
 */
export function markFilterEnds(
  rows: readonly GraphRow[],
  loadedHashes: ReadonlySet<string>,
  filtered: boolean,
): readonly GraphRowMarker[] {
  if (!filtered) return rows as readonly GraphRowMarker[]
  return rows.map((row): GraphRowMarker => {
    if (!row.nodeContinues) return row
    const parent = row.commit.parents[0]
    if (parent !== undefined && !loadedHashes.has(parent)) {
      return { ...row, endOpen: true }
    }
    return row
  })
}
