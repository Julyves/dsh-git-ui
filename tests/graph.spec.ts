/**
 * 分支图车道生命周期算法测试。
 * 用例覆盖:线性延续、分裂、merge 回归、车道回收复用、多车道收敛、图宽度。
 */
import { describe, expect, it } from 'vitest'
import { buildGraph, graphWidth, GRAPH_COLORS, type GraphRow } from '../src/client/git-graph.ts'
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

  it('opens a lane on merge and closes it with a back-edge at the merge-back', () => {
    const rows = buildGraph(MERGE_SEQUENCE)
    // merge 行:节点列 0,分裂曲线 0→1,车道 1 开始等待 feat-1。
    expect(rows[0]).toMatchObject({ column: 0, nodeFromTop: false, nodeContinues: true })
    expect(rows[0]!.edges).toEqual([{ from: 0, to: 1 }])
    // main 行:车道 1 竖线贯穿,节点在 0 延续等待 init。
    expect(rows[1]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: true, verticals: [1] })
    // feat 行:节点在 1,首父 init 已被车道 0 等待 → 回归曲线 1→0,本车道关闭。
    expect(rows[2]).toMatchObject({ column: 1, nodeFromTop: true, nodeContinues: false, verticals: [0] })
    expect(rows[2]!.edges).toEqual([{ from: 1, to: 0 }])
    // init 行:车道 0 承载节点后关闭,无残留竖线(车道不泄漏)。
    expect(rows[3]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false, verticals: [] })
  })

  it('handles a branch split (two children of one root)', () => {
    const rows = buildGraph([commit('B', ['root']), commit('A', ['root']), commit('root', [])])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    // A 的首父 root 已被车道 0 等待 → 回归曲线 1→0。
    expect(rows[1]!.edges).toEqual([{ from: 1, to: 0 }])
    expect(rows[2]).toMatchObject({ column: 0, verticals: [] })
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

  it('converges two child lanes into one parent via a back-edge (merge base)', () => {
    const rows = buildGraph([
      commit('ch1', ['base']),
      commit('ch2', ['base']),
      commit('base', []),
    ])
    // ch1 开车道 0 等待 base；ch2 新开车道 1，首父 base 已被车道 0 等待 → 回归曲线 1→0。
    expect(rows[0]).toMatchObject({ column: 0, nodeContinues: true })
    expect(rows[1]).toMatchObject({ column: 1, nodeFromTop: false, nodeContinues: false })
    expect(rows[1]!.edges).toEqual([{ from: 1, to: 0 }])
    // base 行：车道 0 承载节点后关闭，车道 1 已关闭，无残留竖线。
    expect(rows[2]).toMatchObject({ column: 0, nodeFromTop: true, nodeContinues: false, verticals: [] })
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

describe('GRAPH_COLORS', () => {
  it('has enough color palette entries', () => {
    expect(GRAPH_COLORS.length).toBeGreaterThanOrEqual(16)
  })
})
