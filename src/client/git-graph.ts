/**
 * Git 分支图数据模型与车道生命周期列分配算法。
 *
 * 输入为 `git log --all` 拓扑序（新→旧）的 `GraphCommit[]`。本模块维护一组
 * “车道”（lane）：每条车道等待下一个应出现的提交（waiting-for）。提交到达时：
 *   - 等待该提交的车道承载节点；
 *   - 首父继承当前车道（直线延续）、移交给已等待它的车道（merge 回归，车道
 *     以曲线收尾关闭），或开辟新车道；
 *   - 第二及更多父提交复用已等待它的车道，否则开辟新车道，均产生分裂曲线；
 *   - 释放的车道按索引回收，列数贴近历史真实并发度，永不单调增长。
 *
 * 不变量：同一哈希至多被一条车道等待（首父/附加父路径均先查找复用），
 * 因此“多个子提交汇向同一父提交”的收敛天然由回归曲线表达，无需额外机制。
 *
 * 渲染契约（与行样式共用单一事实来源）：行高固定、条带占满整行，
 * 竖线在行间自然衔接；分裂/回归用贝塞尔曲线。
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
  /** 节点车道在本行之前已存在：自行顶到节点画半段竖线。 */
  readonly nodeFromTop: boolean
  /** 节点车道在本行之后延续：自节点到行底画半段竖线。 */
  readonly nodeContinues: boolean
  /** 自节点向下的曲线（分裂 / merge 回归），终点在行底的目标车道。 */
  readonly edges: readonly GraphEdge[]
}

/** 一条非竖直连接。 */
export interface GraphEdge {
  readonly from: number
  readonly to: number
  /**
   * split = merge 提交开辟子分支车道：曲线属于子分支线路，着目标车道色；
   * return = 首父移交已有车道（分支回归）：曲线属于源分支线路，着源车道色。
   */
  readonly kind: 'split' | 'return'
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

/** 车道生命周期算法：为提交序列分配列并产出渲染几何。 */
export function buildGraph(commits: readonly GraphCommit[]): readonly GraphRow[] {
  const rows: GraphRow[] = []
  /** lanes[i] = 该车道等待的提交哈希；null = 空闲（可回收）。 */
  const lanes: (string | null)[] = []
  /** 本行新开的车道：不画贯穿竖线（分裂曲线是该线在本行的唯一部分，消除残桩）。 */
  let opened: Set<number> = new Set()

  /** 回收第一个空闲车道索引；无空闲则扩容。 */
  const freeLane = (): number => {
    const index = lanes.indexOf(null)
    const lane = index === -1 ? (lanes.push(null), lanes.length - 1) : index
    opened.add(lane)
    return lane
  }

  for (const commit of commits) {
    opened = new Set()
    // 1. 节点列：等待该提交的车道；否则开辟新车道（分支尖端）。
    //    （同一哈希至多一条车道等待，见模块不变量。）
    const waitingLane = lanes.indexOf(commit.hash)
    const column = waitingLane === -1 ? freeLane() : waitingLane
    const nodeFromTop = waitingLane !== -1

    // 2. 首父：原地延续 / 移交已有车道（回归曲线，本车道关闭）/ 根提交关闭。
    const edges: GraphEdge[] = []
    const firstParent = commit.parents[0]
    let nodeContinues = false
    if (firstParent === undefined) {
      lanes[column] = null
    } else {
      const parentLane = lanes.indexOf(firstParent)
      if (parentLane === -1) {
        // 首父尚未出现：本车道继续等待它（直线延续）。
        lanes[column] = firstParent
        nodeContinues = true
      } else {
        // 首父已被其他车道等待：本车道以回归曲线收尾关闭（着源车道色）。
        edges.push({ from: column, to: parentLane, kind: 'return' })
        lanes[column] = null
      }
    }

    // 3. 第二及更多父提交：复用已等待它的车道，否则开辟新车道；均记分裂曲线。
    for (let p = 1; p < commit.parents.length; p += 1) {
      const parentHash = commit.parents[p]!
      let target = lanes.indexOf(parentHash)
      if (target === -1) {
        target = freeLane()
        lanes[target] = parentHash
      }
      edges.push({ from: column, to: target, kind: 'split' })
    }

    // 4. 贯穿竖线：处理后仍在等待的车道；
    //    节点列与本行新开车道除外（后者仅由分裂曲线表达，消除合并行残桩）。
    const verticals: number[] = []
    lanes.forEach((waitingHash, index) => {
      if (waitingHash === null || index === column || opened.has(index)) return
      verticals.push(index)
    })

    rows.push({ commit, column, verticals, nodeFromTop, nodeContinues, edges })
  }

  return rows
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
    for (const edge of row.edges) consider(edge.to)
  }
  return width
}
