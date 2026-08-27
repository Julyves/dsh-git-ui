/**
 * GraphStrip 渲染级测试：锁定「merge 分裂曲线(edges) 染被合并分支侧色，而非 merge 节点色」。
 *
 * 背景（2026-08-25 用户 bug）：dev 被合入 main 时，从 main 节点弯向 dev 车道的那段
 * 曲线被渲染成合并目标（main）色——渲染层此前用 `stroke={nodeColor}`。修复后曲线用
 * `colorOfLane(edge.to)`（目标车道 = 被合并分支侧）。本测试用静态渲染断言 SVG 输出，
 * 真正锁定渲染行为（纯数据层测试无法覆盖渲染层的读色选择）。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraphStrip } from '../../src/client/center/history/CommitRow.tsx'
import { buildGraph, colorOf, createTipAwareColorOf } from '../../src/client/git-graph.ts'
import type { GraphCommit } from '../../src/host/types.ts'

/** 构造提交（可带分支 ref）。 */
function commit(hash: string, parents: string[], branch?: string): GraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject: hash,
    author: 'a',
    dateIso: '2026-01-01T00:00:00Z',
    parents,
    refs: branch ? [{ kind: 'branch', name: branch, head: true }] : [],
  }
}

describe('GraphStrip — merge 分裂曲线染被合并分支色（回归）', () => {
  it('colors the fork curve by the merged-branch side (edge.to), not the merge node/target color', () => {
    // dev 向 main 合并：merge M 在 main 链上，第二父为 dev tip d2（带 dev ref）。
    const seq: GraphCommit[] = [
      commit('M', ['m1', 'd2'], 'main'),
      commit('d2', ['d1'], 'dev'),
      commit('d1', ['base']),
      commit('m1', ['base']),
      commit('base', []),
    ]
    const rows = buildGraph(seq)
    const merge = rows[0]!
    expect(merge.edges).toEqual([{ from: 0, to: 1 }])

    const html = renderToStaticMarkup(<GraphStrip row={merge} cols={2} laneW={14} />)

    // 核心断言：edge 曲线用被合并分支（dev tip d2）侧色。整条 GraphStrip 里
    // 只有 edge 会被赋予 colorOf('d2')；其余线段（延续线/节点）均为 main 色。
    // 若渲染层误用 nodeColor，则不会出现该 stroke，此断言即失败——真实锁定 bug。
    // 防撞守卫：两色确不相同，断言不依赖巧合。
    expect(colorOf('d2')).not.toBe(colorOf('main'))
    expect(html).toContain(`stroke="${colorOf('d2')}"`)
    // 节点填充仍为 merge 所在链色（main）；确认 curve 与节点色解耦。
    expect(html).toContain(`fill="${colorOf('main')}"`)
  })

  it('octopus merge: each fork curve keeps its own merged-branch side color, not the node color', () => {
    // 三父 merge：M 主链 + 两个被合并分支 b、c 各自开出 target 车道。
    const seq: GraphCommit[] = [
      commit('M', ['m1', 'b', 'c'], 'main'),
      commit('b', ['base'], 'feat-b'),
      commit('c', ['base'], 'feat-c'),
      commit('m1', ['base']),
      commit('base', []),
    ]
    const rows = buildGraph(seq)
    const merge = rows[0]!
    // 两条分裂曲线：主列 0 → 被合并分支 b、c 各自车道。
    expect(merge.edges).toEqual([{ from: 0, to: 1 }, { from: 0, to: 2 }])

    const html = renderToStaticMarkup(<GraphStrip row={merge} cols={3} laneW={14} />)

    // 每条曲线染各自目标车道（被合并分支）侧色：merge 行时被合并分支 tip(b/c)尚未处理，
    // 其链色未锚定到 branch ref，故取其确定性散列色 colorOf('b')/colorOf('c')——但**独立于**
    // merge 节点色(main)。若渲染层误统一用 nodeColor，则不会出现这两个散列色 stroke，断言即失败。
    expect(html).toContain(`stroke="${colorOf('b')}"`)
    expect(html).toContain(`stroke="${colorOf('c')}"`)
    // 两条曲线各自独立着色（互不相同，证明按 edge.to 车道取色而非捆绑节点色）。
    expect(colorOf('b')).not.toBe(colorOf('c'))
    expect(colorOf('b')).not.toBe(colorOf('main'))
    expect(colorOf('c')).not.toBe(colorOf('main'))
  })

  it('tip-aware colorOf: fork curve anchors to the merged branch color even when the fallback hash collides with main', () => {
    // 残留根因（用户第二轮反馈）：第二父 tip 未到达时线色回退 hash 散列色——
    // 构造撞色 hash（13 个 'a' 的散列与 main 同为 idx13），裸 colorOf 下曲线
    // 仍显示 main 色；tip 感知（HistoryTab 的 tree.local.shortHash 映射）后锚定 dev 色。
    const D2 = 'a'.repeat(13)
    expect(colorOf(D2)).toBe(colorOf('main')) // 前提：兜底散列确实撞上 main 色
    const seq: GraphCommit[] = [
      commit('m2', ['M'], 'main'),
      commit('M', ['m1', D2]),
      commit(D2, ['d1'], 'dev'),
      commit('m1', ['base']),
      commit('d1', ['base']),
      commit('base', []),
    ]
    // HistoryTab 集成等价路径：分配器 + tip 映射。
    const colorFn = createTipAwareColorOf(colorOf, [[D2.slice(0, 7), 'dev']])
    const rows = buildGraph(seq, colorFn)
    const merge = rows[1]!
    expect(merge.edges).toEqual([{ from: 0, to: 1 }])

    const html = renderToStaticMarkup(<GraphStrip row={merge} cols={2} laneW={14} />)

    // 曲线染被合并分支（dev）锚定色；整行只有 edge 携带该色（节点/延续线为 main 色）。
    expect(html).toContain(`stroke="${colorOf('dev')}"`)
    // 下方 dev tip 行节点同为 dev 锚定色——曲线与分支自身行无跳变。
    expect(rows[2]!.nodeColor).toBe(colorOf('dev'))
  })
})

describe('GraphStrip — V7 赛博轨道选中态', () => {
  it('selected 行：svg 带 --glow 发光类 + 光晕/细环节点组在场', () => {
    const seq: GraphCommit[] = [
      commit('m1', ['base'], 'main'),
      commit('base', []),
    ]
    const rows = buildGraph(seq)
    const htmlSel = renderToStaticMarkup(<GraphStrip row={rows[0]!} cols={1} laneW={14} selected />)
    // 轨道发光类（V7 的图列重音）。
    expect(htmlSel).toContain('dsh-git-ui__graph--glow')
    // 光晕（大半径实心）+ 落定细环。
    expect(htmlSel).toContain('dsh-git-ui__sel-ring')
    expect(htmlSel).toContain('dsh-git-ui__graph-sel')
    // 非选中行：无发光类、无选中节点组。
    const htmlPlain = renderToStaticMarkup(<GraphStrip row={rows[1]!} cols={1} laneW={14} />)
    expect(htmlPlain).not.toContain('dsh-git-ui__graph--glow')
    expect(htmlPlain).not.toContain('dsh-git-ui__graph-sel')
  })
})
