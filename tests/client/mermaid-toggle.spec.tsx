// @vitest-environment jsdom
/**
 * Mermaid 块渲染/源码切换交互测试：点击「源码」→ 显示源码 pre（SVG 消失），
 * 再点「渲染」→ SVG 回归。MarkdownView 全链挂载（含高亮器安全降级）。
 */
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MarkdownView } from '../../src/client/markdown.tsx'
import { zh } from '../../src/client/locales.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const DOC = [
  '# 标题',
  '',
  '```mermaid',
  'graph TD',
  '  A[开始] --> B[结束]',
  '```',
].join('\n')

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('MermaidBlock — 渲染/源码切换', () => {
  it('默认渲染态显示 SVG；点「源码」切 pre；再点「渲染」切回 SVG', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(<MarkdownView source={DOC} fontSize={12} highlight t={t} />)
    await flush()

    // 默认渲染态。
    expect(container.querySelector('svg')).not.toBeNull()

    // 点「源码」：SVG 消失、源码 pre 在场。
    const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    const sourceBtn = buttons.find((b) => b.textContent === zh['diff.mermaid.source'])
    expect(sourceBtn).toBeDefined()
    sourceBtn!.click()
    await flush()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('graph TD')

    // 点「渲染」：切回 SVG。
    const renderBtn = ([...container.querySelectorAll('button')] as HTMLButtonElement[])
      .find((b) => b.textContent === zh['diff.view.rendered'])
    renderBtn!.click()
    await flush()
    expect(container.querySelector('svg')).not.toBeNull()

    root.unmount()
  })
})
