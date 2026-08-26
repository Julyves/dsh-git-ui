// @vitest-environment jsdom
/**
 * 历史搜索框一键清除交互测试：
 *   - 输入非空 → 内嵌 X 按钮出现（aria-label = 清除搜索）；
 *   - 点击 X → 输入立即清空且过滤立即落地（不等 300ms 防抖）——断言
 *     点击后立刻（真实计时 0ms）发起的 history 查询不再携带搜索词。
 */
import { describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { HistoryTab } from '../../src/client/center/history/HistoryTab.tsx'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitQueryRequest, GitQueryResult } from '../../src/host/types.ts'
import type { GitQueryOutcome } from '../../src/client/controller.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })

/** history 查询桩：记录每次请求的 search 词，返回空结果。 */
function makeQuery() {
  const searches: string[] = []
  const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
    if (q.kind === 'history') searches.push(q.search ?? '')
    const value: GitQueryResult = q.kind === 'history'
      ? { kind: 'history', commits: [], total: 0 }
      : q.kind === 'branches'
        ? { kind: 'branches', current: 'main', defaultBranch: 'main', local: [], remote: [] }
        : q.kind === 'tags'
          ? { kind: 'tags', tags: [] }
          : { kind: 'authors', authors: [] }
    return { ok: true, value }
  }
  return { searches, query }
}

/** 多轮事件循环冲刷（jsdom 下 React 并发调度按事件循环轮次推进）。 */
async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

async function mount(query: ReturnType<typeof makeQuery>['query']): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<HistoryTab query={query} run={run} t={t} />)
  await flush()
  return { container, root }
}

describe('HistoryTab — 搜索一键清除', () => {
  it('空输入无清除按钮；输入后出现，点击立即清空并立即重查（无防抖等待）', async () => {
    const { searches, query } = makeQuery()
    const { container, root } = await mount(query)
    const input = container.querySelector(`input[aria-label="${zh['history.search']}"]`) as HTMLInputElement

    // 空输入：无清除按钮。
    expect(container.querySelector(`button[aria-label="${zh['history.clearSearch']}"]`)).toBeNull()

    // 输入 "abc"（不冲刷 300ms 防抖——filter 尚未落地）。
    // jsdom 下 React 受控 input 须经原生 value setter + input 事件驱动 onChange。
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    nativeSetter?.call(input, 'abc')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    const clear = container.querySelector(`button[aria-label="${zh['history.clearSearch']}"]`) as HTMLButtonElement
    expect(clear).not.toBeNull()

    // 点击 X：立即（0ms 内）清空输入 + 过滤落地重查——不带搜索词。
    clear.click()
    await flush(3)
    expect(input.value).toBe('')
    expect(container.querySelector(`button[aria-label="${zh['history.clearSearch']}"]`)).toBeNull()
    // 最后一次 history 查询的 search 为空（立即落地，未经 300ms）。
    expect(searches[searches.length - 1]).toBe('')

    root.unmount()
  })
})
