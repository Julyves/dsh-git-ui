/**
 * 构造失败自动重试测试：首次 createHighlighterCoreSync 抛错（模拟环境异常 /
 * 瞬态失败）→ 渲染层保持纯文本（undefined）且失败原因可观测；
 * 下次调用自动重试 → 成功后就绪计数递增、tokens 恢复。
 */
import { describe, expect, it, vi } from 'vitest'

// 模块级 mock：第一次构造抛错，之后透传真实实现（mock 是单文件级，
// 不影响其它测试文件的真实 shiki 路径）。
vi.mock('shiki/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shiki/core')>()
  let failed = false
  return {
    ...actual,
    createHighlighterCoreSync: ((...args: Parameters<typeof actual.createHighlighterCoreSync>) => {
      if (!failed) {
        failed = true
        throw new Error('transient init failure')
      }
      return actual.createHighlighterCoreSync(...args)
    }) as typeof actual.createHighlighterCoreSync,
  }
})

import { highlightFailureReason, highlightLines, highlightReadyCount, subscribeHighlightReady } from '../../src/client/syntax/highlighter.ts'

const waitMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('highlighter init retry', () => {
  it('records the failure reason, keeps plain-text fallback, then recovers on retry', async () => {
    // 首次触发：构造失败
    expect(highlightLines('const x = 1', 'typescript')).toBeUndefined()
    await waitMicrotasks()
    expect(highlightReadyCount()).toBe(0)
    expect(highlightFailureReason()).toContain('transient init failure')

    // 重试：再次调用 → 重新构造 → 成功
    const tokens = highlightLines('const x = 1', 'typescript')
    await new Promise<void>((resolve) => {
      if (highlightReadyCount() > 0) { resolve(); return }
      const off = subscribeHighlightReady(() => { off(); resolve() })
      setTimeout(() => { off(); resolve() }, 3000)
    })
    expect(highlightReadyCount()).toBe(1)
    expect(highlightFailureReason()).toBeUndefined()
    // 就绪后的调用产出带颜色的 token
    const fresh = highlightLines('const x = 1', 'typescript')
    expect(fresh).toBeDefined()
    expect(fresh![0]![0]!.style.color).toContain('var(--shiki-')
    void tokens
  })
})
