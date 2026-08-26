// @vitest-environment jsdom
/**
 * HistoryFilterTree 复现（bug-hunt 2026-08-26）。
 *
 * B4：分支/远程行由 `row()` 工厂渲染且未携带 React key——所有 `.map((b) => row(...))`
 * 调用点（4 处）产出无 key 列表项，React 开发构建告警
 * 「Each child in a list should have a unique "key" prop」。
 * B9：`branchFace` 以「剥前缀后的名字 === defaultBranch」判定默认分支星标——
 * 本地文件夹分支 `feature/main`（bare='main'）被误标为默认分支（星形+琥珀色）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { HistoryFilterTree } from '../../src/client/center/history/HistoryFilterTree.tsx'
import { zh } from '../../src/client/locales.ts'
import type { GitBranch } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

function branch(name: string): GitBranch {
  return { name, shortHash: 'abc1234' }
}

const baseTree = {
  // current 设为 dev：main 走「默认分支=星形」路径（否则 current 命中会先走
  // checkout 标记，掩盖 star 计数语义）。
  current: 'dev',
  defaultBranch: 'main',
  local: [branch('main'), branch('dev'), branch('feature/main'), branch('feature/x')],
  remote: [] as readonly GitBranch[],
  tags: [] as readonly GitBranch[],
}

describe('HistoryFilterTree — B4 缺 key / B9 星标误标', () => {
  // 回归锁（B4 已修复）：row() 工厂内补 key={name}。
  it('B4 回归锁: 分支行渲染不产生 unique key 告警', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ')
      if (text.includes('key')) errors.push(text)
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <HistoryFilterTree
        tree={baseTree}
        filter={{ kind: 'all' }}
        onFilter={() => {}}
        closed={new Set(['tags'])}
        onToggleSection={() => {}}
        onFetch={async () => {}}
        fetching={false}
        fetchNote={null}
        t={t}
      />,
    )
    await new Promise((r) => setTimeout(r, 50))
    root.unmount()
    spy.mockRestore()
    // eslint-disable-next-line no-console
    console.log(`[B4] key-related console.error count=${errors.length}${errors.length > 0 ? ` first=${errors[0]!.slice(0, 80)}` : ''}`)
    // 期望行为：无 key 告警。当前实现产生告警 → FAIL。
    expect(errors.length).toBe(0)
  }, 10_000)

  // 回归锁（B9/B7 已修复）：isDefaultRef 全名比对。
  it('B7 回归锁: `feature/main` 不显示默认分支星标（仅 main 得星）', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(
      <HistoryFilterTree
        tree={baseTree}
        filter={{ kind: 'all' }}
        onFilter={() => {}}
        closed={new Set(['tags'])}
        onToggleSection={() => {}}
        onFetch={async () => {}}
        fetching={false}
        fetchNote={null}
        t={t}
      />,
    )
    // StarIcon 的独特星形 path（M6 0.8 l1.5 3.1 ...）作为选择器；统计出现次数。
    const stars = html.match(/M6 0\.8 l1\.5 3\.1/g)?.length ?? 0
    // eslint-disable-next-line no-console
    console.log(`[B9] 'star' svg occurrences=${stars}`)
    // current='dev' 时：main → 星形（正确）；feature/main → bare='main' 也得星（误标）。
    // 期望行为：仅 main 一个星（=1）。当前实现 2 → FAIL。
    expect(stars).toBe(1)
  })
})
