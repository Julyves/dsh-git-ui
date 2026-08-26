/**
 * 分支图车道生命周期算法测试。
 * 用例覆盖:线性延续、分裂、merge 回归、车道回收复用、收敛、图宽度。
 */
import { describe, expect, it } from 'vitest'
import { buildGraph, colorOf, createGraphBuilder, createTipAwareColorOf, graphWidth, markFilterEnds, GRAPH_COLORS } from '../src/client/git-graph.ts'
import type { GraphCommit } from '../src/host/types.ts'

/** 构造简单提交链(新→旧,与 git log 输出序一致)。 */
function chain(hashes: string[]): GraphCommit[] {
  const commits: GraphCommit[] = []
  for (let i = 0; i < hashes.length; i += 1) {
    commits.push({
      hash: hashes[i]!,
      shortHash: hashes[i]!.slice(0, 7),
      subject: `commit ${i}`,
      author: 'test',
      dateIso: '2026-01-01T00:00:00Z',
      parents: i === hashes.length - 1 ? [] : [hashes[i + 1]!],
      refs: [],
    })
  }
  return commits
}

/** 构造单个提交。 */
function commit(hash: string, parents: string[]): GraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject: hash,
    author: 'test',
    dateIso: '2026-01-01T00:00:00Z',
    parents,
    refs: [],
  }
}

/** merge 示例:merge → main/feat 两线 → init 汇合。 */
const MERGE_SEQUENCE = [
  commit('merge', ['main-1', 'feat-1']),
  commit('main-1', ['init']),
  commit('feat-1', ['init']),
  commit('init', []),
] as const

describe('buildGraph', () => {
  it('returns an empty array for empty input', () => {
    expect(buildGraph([])).toEqual([])
  })

  it('assigns column 0 to a linear chain with correct segment shapes', () => {
    const rows = buildGraph(chain(['a', 'b', 'c']))
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    // 尖端:上方无线,下方延续。
    expect(rows[0]).toMatchObject({ nodeFromTop: false, nodeContinues: true, verticals: [], edges: [] })
    // 中段:上下均有线。
    expect(rows[1]).toMatchObject({ nodeFromTop: true, nodeContinues: true, verticals: [] })
    // 根提交:上方有线,下方关闭。
    expect(rows[2]).toMatchObject({ nodeFromTop: true, nodeContinues: false, verticals: [] })
  })

  it('keeps two parallel rails through a merge and joins them at the base', () => {
    const rows = buildGraph(MERGE_SEQUENCE)
    // merge 行:节点列 0,分裂曲线 0→1,车道 1 开始等待 feat-1。
    expect(rows[0]).toMatchObject({ column: 0, nodeFromTop: false, nodeContinues: true })
    expect(rows[0]!.edges).toEqual([{ from: 0, to: 1 }])
    // 残桩消除:本行新开的车道不画贯穿竖线(分裂曲线是该线唯一部分)。
    expect(rows[0]!.verticals).toEqual([])
    // main 行:车道 1 竖线贯穿,节点在 0 延续等待 init。
    expect(rows[1]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: true, verticals: [1] })
    // feat 行:节点在 1,继续等待 init(不再提前回归),车道 0 竖线贯穿。
    expect(rows[2]).toMatchObject({ column: 1, nodeFromTop: true, nodeContinues: true, verticals: [0], joins: [] })
    expect(rows[2]!.edges).toEqual([])
    // init 行:车道 0 承载节点,车道 1 经水平连接线汇入(joins=[1])后关闭,无残留竖线。
    expect(rows[3]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false, verticals: [], joins: [1] })
  })

  it('handles a branch split (two children of one root)', () => {
    const rows = buildGraph([commit('B', ['root']), commit('A', ['root']), commit('root', [])])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    // A 的首父 root 已被车道 0 等待 → A 车道继续等 root(不回归),本行车道 0 竖线贯穿。
    expect(rows[1]).toMatchObject({ column: 1, nodeFromTop: false, nodeContinues: true, verticals: [0] })
    expect(rows[1]!.edges).toEqual([])
    // root 行:车道 0 承载节点,车道 1 汇入(joins=[1])。
    expect(rows[2]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false, verticals: [], joins: [1] })
  })

  it('recycles a freed lane for a later branch tip', () => {
    const rows = buildGraph([
      commit('b1', ['r1']),
      commit('a1', ['r2']),
      commit('r1', []),
      commit('t1', ['p1']),
      commit('p1', []),
    ])
    // b1 占车道 0,a1 占车道 1;r1 关闭车道 0。
    expect(rows[2]).toMatchObject({ column: 0, nodeContinues: false })
    // t1 为新尖端:回收空闲的车道 0(而非扩容到 2)。
    expect(rows[3]).toMatchObject({ column: 0, nodeFromTop: false, nodeContinues: true })
    // a1 的车道 1 仍在等待 r2:后续行竖线贯穿。
    expect(rows[3]!.verticals).toEqual([1])
    expect(rows[4]).toMatchObject({ column: 0, nodeContinues: false, verticals: [1] })
  })

  it('converges two child lanes at the shared parent (merge base)', () => {
    const rows = buildGraph([
      commit('ch1', ['base']),
      commit('ch2', ['base']),
      commit('base', []),
    ])
    // ch1 开车道 0 等待 base；ch2 新开车道 1 也等待 base(不回归)。
    expect(rows[0]).toMatchObject({ column: 0, nodeContinues: true })
    expect(rows[1]).toMatchObject({ column: 1, nodeFromTop: false, nodeContinues: true, verticals: [0] })
    expect(rows[1]!.edges).toEqual([])
    // base 行:车道 0 承载节点,车道 1 汇入(joins=[1]),无残留竖线。
    expect(rows[2]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false, verticals: [], joins: [1] })
  })

  it('anchors a fork at the fork commit (no early return above the parent)', () => {
    // 用户场景:main 上 c44 处迁出 dev。两种顺序(main 先 / dev 先)均应在 c44 行汇合。
    const orders: readonly (readonly GraphCommit[])[] = [
      [commit('m2', ['m1']), commit('m1', ['c44']), commit('d2', ['d1']), commit('d1', ['c44']), commit('c44', ['base']), commit('base', [])],
      [commit('m2', ['m1']), commit('d2', ['d1']), commit('d1', ['c44']), commit('m1', ['c44']), commit('c44', ['base']), commit('base', [])],
    ]
    for (const seq of orders) {
      const rows = buildGraph(seq)
      // 父为 c44 的子女行都不再提前回归:直线延续到 c44(修复原「上方一行拐弯偏移」)。
      for (const r of rows) {
        if (r.commit.parents[0] === 'c44') expect(r.nodeContinues).toBe(true)
      }
      // c44 行:首车道承载节点,另一车道经 joins 汇入(无残留贯穿竖线)——发散点锚定 c44。
      const c44 = rows.find((r) => r.commit.hash === 'c44')!
      expect(c44.nodeFromTop).toBe(true)
      expect(c44.joins.length).toBe(1)
      expect(c44.verticals).toEqual([])
    }
  })

  it('keeps a lane open at the pagination boundary (parent not yet loaded)', () => {
    const rows = buildGraph([commit('x', ['y']), commit('y', ['unloaded'])])
    // y 的首父不在序列内：车道延续到行底（竖线下半段），等待下一页。
    expect(rows[1]).toMatchObject({ nodeFromTop: true, nodeContinues: true })
  })
})

describe('graphWidth', () => {
  it('returns 0 for an empty graph', () => {
    expect(graphWidth([])).toBe(0)
  })

  it('counts every lane touched by nodes, verticals and edges', () => {
    expect(graphWidth(buildGraph(MERGE_SEQUENCE))).toBe(2)
    expect(graphWidth(buildGraph(chain(['a'])))).toBe(1)
  })
})

describe('createGraphBuilder', () => {
  it('matches the one-shot buildGraph when fed in parts', () => {
    const oneShot = buildGraph(MERGE_SEQUENCE)
    const builder = createGraphBuilder()
    const p1 = builder.append(MERGE_SEQUENCE.slice(0, 2))
    const p2 = builder.append(MERGE_SEQUENCE.slice(2))
    expect([...p1, ...p2]).toEqual(oneShot)
    expect(builder.count).toBe(MERGE_SEQUENCE.length)
  })

  it('does not mutate previously returned rows when appending more', () => {
    const builder = createGraphBuilder()
    const p1 = builder.append(MERGE_SEQUENCE.slice(0, 2))
    const before = [...p1]
    builder.append(MERGE_SEQUENCE.slice(2))
    expect(p1).toEqual(before)
  })

  it('continues the lane simulation across append boundaries', () => {
    const builder = createGraphBuilder()
    builder.append([commit('a', ['b'])])
    builder.append([commit('b', ['c'])]) // b 的首父 c 未出现 → 车道延续
    const rows = builder.append([commit('c', [])])
    expect(rows[0]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false })
  })
})

describe('GRAPH_COLORS', () => {
  it('has enough color palette entries', () => {
    expect(GRAPH_COLORS.length).toBeGreaterThanOrEqual(16)
  })
})

describe('markFilterEnds', () => {
  const seq = [commit('a', ['b']), commit('b', [])]

  it('returns the same rows unchanged when not filtered', () => {
    const rows = buildGraph(seq)
    expect(markFilterEnds(rows, new Set(['a', 'b']), false)).toBe(rows)
  })

  it('leaves continuations solid when the parent is loaded', () => {
    const marked = markFilterEnds(buildGraph(seq), new Set(['a', 'b']), true)
    expect(marked[0]!.endOpen).toBeUndefined()
    // 根提交 nodeContinues=false，恒不标记
    expect(marked[1]!.endOpen).toBeUndefined()
  })

  it('marks a continuation whose parent is missing from the loaded set', () => {
    // 'b' 不在已加载集合（被过滤/未载入）→ a 的延续线悬垂 → 标 endOpen
    const marked = markFilterEnds(buildGraph(seq), new Set(['a']), true)
    expect(marked[0]!.endOpen).toBe(true)
    expect(marked[1]!.endOpen).toBeUndefined()
  })

  it('marks any continuation whose parent is missing, never a closed/root row', () => {
    const rows = buildGraph(MERGE_SEQUENCE)
    // 新算法下 feat 行为延续行(nodeContinues=true)，其父 init 缺失 → 过滤下标 endOpen。
    // 集合缺 init：merge 行延续 main-1（在场）不标；main 行延续 init（缺失）标；feat 延续 init（缺失）标。
    const marked = markFilterEnds(rows, new Set(['merge', 'main-1', 'feat-1']), true)
    expect(marked[2]!.endOpen).toBe(true)
    // init 为根(nodeContinues=false) → 恒不标。
    expect(marked[3]!.endOpen).toBeUndefined()
  })
})

describe('colorOf / laneHashes / 链色（IDEA 语义）', () => {
  it('colorOf derives a stable color from a key (same key, same color)', () => {
    expect(colorOf('abc123')).toBe(colorOf('abc123'))
    // mod 16 散列理论可碰撞：此处仅验证「这两条具体键不撞」，非普适不变量。
    expect(colorOf('abc123')).not.toBe(colorOf('def456'))
    expect(GRAPH_COLORS).toContain(colorOf('abc123'))
  })

  it('records lane owners: linear chain lanes keyed by their source commit', () => {
    const rows = buildGraph(chain(['a', 'b', 'c']))
    // 每行车道的 owner = 当前提交（列线归属）。
    expect(rows[2]!.laneHashes).toEqual({ 0: 'c' })
    expect(rows[1]!.laneHashes).toMatchObject({ 0: 'b' })
    expect(rows[0]!.laneHashes).toMatchObject({ 0: 'a' })
  })

  it('keys merge edge lanes by the second parent (merged branch keeps its source color)', () => {
    const rows = buildGraph(MERGE_SEQUENCE)
    // merge 行：节点列 0 owner=merge（首父延续）；分裂目标 1 owner=第二父 feat-1
    // （被合并分支染源色而非 merge 色——IDEA 语义：侧链保持源色）。
    expect(rows[0]!.laneHashes).toMatchObject({ 0: 'merge', 1: 'feat-1' })
    // feat 行：贯穿竖线车道 0 属 main-1（其首父线）；节点列 1 属 feat-1。
    expect(rows[2]!).toMatchObject({ column: 1, verticals: [0] })
    expect(rows[2]!.laneHashes).toMatchObject({ 0: 'main-1', 1: 'feat-1' })
  })

  it('keeps one chain color along a linear chain (IDEA semantics, no rainbow)', () => {
    const rows = buildGraph(chain(['a', 'b', 'c']))
    expect(rows.every((r) => r.nodeColor === colorOf('a'))).toBe(true)
    // 下行延续线（等待父）与上行来线全部同链色。
    expect(rows[1]!.lineColors?.[0]).toBe(colorOf('a'))
    expect(rows[0]!.lineColors?.[0]).toBe(colorOf('a'))
  })

  it('anchors the whole chain by its branch ref name', () => {
    const commits = [
      { ...commit('a', ['b']), refs: [{ kind: 'branch' as const, name: 'dev', head: true }] },
      commit('b', ['c']),
      commit('c', []),
    ]
    const rows = buildGraph(commits)
    expect(rows.every((r) => r.nodeColor === colorOf('dev'))).toBe(true)
  })

  it('keeps the merged branch lane at its source color (IDEA: side chain keeps source color)', () => {
    const rows = buildGraph(MERGE_SEQUENCE)
    // merge 分裂曲线（edges）渲染读 edge.to 车道色 = lineColors[1]
    // = 被合并分支源色 colorOf('feat-1')——侧链不染 merge 色（IDEA 语义修正）。
    // 曲线承载被合并分支走向，须保持其源色；不随 merge 节点色（否则提前染成合并目标色）。
    expect(rows[0]!.lineColors?.[1]).toBe(colorOf('feat-1'))
    // main-1 行贯穿的 feat 车道线保持 feat-1 源色（owner=feat-1，未到达→hash 兜底色）。
    expect(rows[1]!.lineColors?.[1]).toBe(colorOf('feat-1'))
  })

  it('colors the merge fork curve by the merged-branch side, not the merge node/target color (回归: 弯折段提前染目标色)', () => {
    // dev 向 main 合并：merge M 在 main 链上，第二父为 dev tip d2（带 dev ref）。
    const seq = [
      { ...commit('M', ['m1', 'd2']), refs: [{ kind: 'branch' as const, name: 'main', head: true }] },
      { ...commit('d2', ['d1']), refs: [{ kind: 'branch' as const, name: 'dev', head: false }] },
      commit('d1', ['base']),
      commit('m1', ['base']),
      commit('base', []),
    ]
    const rows = buildGraph(seq)
    const merge = rows[0]!
    expect(merge.edges).toEqual([{ from: 0, to: 1 }])
    // 渲染层读 edge.to 车道色：曲线染被合并分支（dev tip d2）侧色，
    // 而非 merge 节点色(main)——这是用户可见的「dev 弯向 main 段提前染 main 色」bug 的锁定点。
    expect(merge.lineColors?.[1]).not.toBe(merge.nodeColor)
    expect(merge.lineColors?.[1]).toBe(colorOf('d2'))
  })

  it('anchors the merge fork lane to the merged-branch tip via tip-aware colorOfFn (回归: 兜底散列撞目标色)', () => {
    // 残留根因复现：merge 行时第二父 tip 未到达，线色回退 colorOfFn(parentHash) 的
    // hash 散列色——与分支锚定色脱节，且 1/24 概率撞上合并目标分支色。
    // 构造撞色 hash：hashKey('main') % 24 == 13，13 个 'a' 的散列同为 13。
    const D2 = 'a'.repeat(13)
    expect(colorOf(D2)).toBe(colorOf('main')) // 前提：兜底散列确实撞上 main 色
    const seq = [
      { ...commit('m2', ['M']), refs: [{ kind: 'branch' as const, name: 'main', head: true }] },
      commit('M', ['m1', D2]),
      { ...commit(D2, ['d1']), refs: [{ kind: 'branch' as const, name: 'dev', head: false }] },
      commit('m1', ['base']),
      commit('d1', ['base']),
      commit('base', []),
    ]
    // 无 tip 感知（裸 colorOf）：merge 行 edge.to 车道 = 兜底散列色 = main 色 → 复现 bug。
    const raw = buildGraph(seq)
    const rawMerge = raw[1]!
    expect(rawMerge.nodeColor).toBe(colorOf('main'))
    expect(rawMerge.lineColors?.[1]).toBe(colorOf('main')) // 撞色：曲线仍显示 main 色
    // tip 感知 colorOfFn（createTipAwareColorOf，HistoryTab 用 tree.local.shortHash 映射）：
    // 命中分支 tip 短哈希前缀 → 返回分支锚定色，曲线与 dev 自身行同色。
    const fixed = buildGraph(seq, createTipAwareColorOf(colorOf, [[D2.slice(0, 7), 'dev']]))
    const fixedMerge = fixed[1]!
    expect(fixedMerge.lineColors?.[1]).toBe(colorOf('dev'))
    // 与被合并分支自身行（d2 node 锚定 dev 色）同色——无跳变。
    expect(fixed[2]!.nodeColor).toBe(colorOf('dev'))
    expect(fixedMerge.lineColors?.[1]).toBe(fixed[2]!.nodeColor)
  })

  it('keeps joins lanes at their own child chain colors (distinct branches)', () => {
    // 两个子提交各锚定不同分支：汇聚行（base）的 joins 线保持各自子链色，节点取主链色。
    const seq = [
      { ...commit('a', ['base']), refs: [{ kind: 'branch' as const, name: 'main', head: true }] },
      { ...commit('b', ['base']), refs: [{ kind: 'branch' as const, name: 'feature', head: false }] },
      commit('base', []),
    ]
    const rows = buildGraph(seq)
    // base 汇聚行：节点列 0 继承首个等待者（a/main）链色；joins 车道 1 保持 feature 子链色。
    expect(rows[2]!).toMatchObject({ column: 0, joins: [1] })
    expect(rows[2]!.nodeColor).toBe(colorOf('main'))
    expect(rows[2]!.lineColors?.[0]).toBe(colorOf('main'))
    expect(rows[2]!.lineColors?.[1]).toBe(colorOf('feature'))
  })
})

describe('分支起点行的来线色（IDEA 分叉视觉）', () => {
  it('keeps the incoming line at the upstream chain color while the node takes the new branch color', () => {
    const commits = [
      { ...commit('a', ['b']), refs: [{ kind: 'branch' as const, name: 'dev', head: true }] },
      { ...commit('b', ['c']), refs: [{ kind: 'branch' as const, name: 'test', head: false }] },
      commit('c', []),
    ]
    const rows = buildGraph(commits)
    // b 行（test 分支 tip）：节点 = test 链色；来线段（来自 a 的 dev 链）= dev 色；
    // 延续线段（等待 c）= 当前 test 链色——同一列两段线各归其色（IDEA 分叉视觉）。
    expect(rows[1]!.nodeColor).toBe(colorOf('test'))
    expect(rows[1]!.incomingColor).toBe(colorOf('dev'))
    expect(rows[1]!.lineColors?.[0]).toBe(colorOf('test'))
    // c 行：继承子链（b）的 test 色；来线 = test 色；a 行延续线段属 dev 链（保 dev 色）。
    expect(rows[2]!.nodeColor).toBe(colorOf('test'))
    expect(rows[2]!.incomingColor).toBe(colorOf('test'))
    expect(rows[0]!.lineColors?.[0]).toBe(colorOf('dev'))
  })
})

describe('markFilterEnds — openLanes(H6:merge 副父悬垂端标)', () => {
  it('marks a vertical lane persisting to the graph tail (parent filtered out)', () => {
    // 过滤后提交集不含 b(c 的第二父):merge c 首父 a、副父 b——b 的车道
    // 自 c 开出后无人消费,贯到图尾 → 末行以 openLanes 端标标示。
    const seq = [
      commit('c', ['a', 'b']),
      commit('a', []),
    ]
    const rows = buildGraph(seq)
    const marked = markFilterEnds(rows, new Set(['c', 'a']), true)
    const tail = marked[1]! // a 行为末行,含 b 车道(openLanes)
    expect(tail.openLanes).toBeDefined()
    expect(tail.openLanes?.length).toBeGreaterThan(0)
    // c 行(车道新开,自带 opened 豁免)不标。
    expect(marked[0]!.openLanes).toBeUndefined()
  })

  it('no openLanes when every lane resolves within the loaded set', () => {
    const seq = [commit('c', ['a', 'b']), commit('b', []), commit('a', [])]
    const marked = markFilterEnds(buildGraph(seq), new Set(['a', 'b', 'c']), true)
    expect(marked.every((row) => row.openLanes === undefined)).toBe(true)
  })
})
