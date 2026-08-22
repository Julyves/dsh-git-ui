/**
 * 「未就绪 → 组件不调 highlightLines → 永不就绪」蛋鸡死锁的防回归测试。
 *
 * 复刻组件层真实时序：组件挂载只调用 `ensureHighlightInit()`（useHighlightReady
 * 的入口），**不**预调 `highlightLines()`（组件在 ready>0 前根本不会调用它）。
 * 独立模块实例（vi.resetModules + 动态 import）保证从未预热过的初始状态——
 * 若构造只能由 highlightLines 触发，本测试将超时失败（就绪永不到来）。
 */
import { describe, expect, it, vi } from 'vitest'

describe('highlight init via subscriber entry (deadlock guard)', () => {
  it('reaches ready from ensureHighlightInit alone, then tokenizes', async () => {
    vi.resetModules()
    const fresh = await import('../../src/client/syntax/highlighter.ts')

    // 组件挂载路径：只触发初始化入口，绝不预调 highlightLines。
    fresh.ensureHighlightInit()
    expect(fresh.highlightReadyCount()).toBe(0)

    await new Promise<void>((resolve) => {
      const off = fresh.subscribeHighlightReady(() => { off(); resolve() })
      if (fresh.highlightReadyCount() > 0) { off(); resolve(); return }
      setTimeout(() => { off(); resolve() }, 3000)
    })

    expect(fresh.highlightReadyCount()).toBe(1)
    const tokens = fresh.highlightLines('const answer = 42', 'typescript')
    expect(tokens).toBeDefined()
    expect(tokens![0]![0]!.style.color).toContain('var(--shiki-')
  })

  it('ensureHighlightInit is idempotent (repeated calls do not re-construct)', async () => {
    vi.resetModules()
    const fresh = await import('../../src/client/syntax/highlighter.ts')
    fresh.ensureHighlightInit()
    fresh.ensureHighlightInit()
    fresh.ensureHighlightInit()
    await new Promise<void>((resolve) => {
      const off = fresh.subscribeHighlightReady(() => { off(); resolve() })
      if (fresh.highlightReadyCount() > 0) { off(); resolve(); return }
      setTimeout(() => { off(); resolve() }, 3000)
    })
    expect(fresh.highlightReadyCount()).toBe(1)
  })
})
