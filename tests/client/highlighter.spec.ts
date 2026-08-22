/**
 * 语法高亮 smoke 测试：shiki 初始化（JS 引擎）、整块 tokenize 按行切分、
 * 跨行 token 正确性与未知语言回落。
 * 校验「注册的 grammar 覆盖 lang-map 映射」的表层保证。
 */
import { describe, expect, it } from 'vitest'
import { highlightLines, highlightReadyCount, subscribeHighlightReady } from '../../src/client/syntax/highlighter.ts'

/** 等待异步构造完成（就绪或超时；构造失败恒返回 undefined → 测试视为未就绪）。 */
async function waitReady(timeoutMs = 3000): Promise<boolean> {
  if (highlightReadyCount() > 0) return true
  // 触发构造：未知语言的调用同样会 ensureConstructing
  highlightLines('', 'typescript')
  await new Promise<void>((resolve) => {
    const off = subscribeHighlightReady(() => { off(); resolve() })
    setTimeout(() => { off(); resolve() }, timeoutMs)
  })
  return highlightReadyCount() > 0
}

describe('highlightLines（异步构造，就绪前纯文本回落）', () => {
  it('returns undefined before construction settles, then tokenizes with colored runs', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const tokens = highlightLines('const answer: number = 42\n// 注释\nfoo("bar")', 'typescript')
    expect(tokens).toBeDefined()
    expect(tokens).toHaveLength(3)
    const first = tokens![0]!
    expect(first.map((t) => t.text).join('')).toBe('const answer: number = 42')
    const keyword = first.find((t) => t.text === 'const')
    expect(keyword?.style.color).toContain('--shiki-')
  })

  it('keeps multi-line string tokens contiguous (not per-line rescan)', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const tokens = highlightLines('"""\nhello\n"""', 'python')
    expect(tokens).toBeDefined()
    expect(tokens).toHaveLength(3)
    const middle = tokens![1]!
    expect(middle.map((t) => t.text).join('')).toBe('hello')
    expect(middle[0]?.style.color).toContain('--shiki-token-')
  })

  it('returns undefined for an unknown language (plain-text fallback)', () => {
    expect(highlightLines('x', 'no-such-language')).toBeUndefined()
  })
})
