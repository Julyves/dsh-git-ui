/**
 * minify 产物内的语法高亮全管线测试（防回归——覆盖真实发布场景）。
 *
 * 用户环境执行的是 `lib/client.js` 的**esbuild minify 后**内容，而非 ts 源码；
 * 本测试用与 build.mjs 相同的浏览器配置把 `syntax/highlighter.ts` 打包成
 * 临时产物并驱动完整异步管线（触发构造 → 就绪通知 → token 颜色），
 * 断言产物内 shiki 可用且颜色仍为 `var(--shiki-*)` 变量引用
 * （与宿主 ui-theme shiki.css 的 :root 变量表对齐）。
 */
import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function buildProbe(): Promise<{ load(): Promise<typeof import('../../src/client/syntax/highlighter.ts')>; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-ui-hl-probe-'))
  const out = join(dir, 'probe.cjs')
  await build({
    entryPoints: [join(import.meta.dirname, '../../src/client/syntax/highlighter.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    outfile: out,
    logLevel: 'silent',
  })
  return {
    load: async () => import(`${out}?t=${Date.now()}`),
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  }
}

/** 等待产物内构造完成（就绪或超时）。 */
async function waitReady(mod: typeof import('../../src/client/syntax/highlighter.ts')): Promise<boolean> {
  if (mod.highlightReadyCount() > 0) return true
  mod.highlightLines('', 'typescript')
  await new Promise<void>((resolve) => {
    const off = mod.subscribeHighlightReady(() => { off(); resolve() })
    setTimeout(() => { off(); resolve() }, 5000)
  })
  return mod.highlightReadyCount() > 0
}

describe('minified highlight pipeline', () => {
  it('tokenizes with var(--shiki-*) colors inside the minified bundle', async () => {
    const probe = await buildProbe()
    try {
      const mod = await probe.load()
      const ready = await waitReady(mod)
      expect(ready).toBe(true)
      if (!ready) expect(mod.highlightFailureReason()).toBeUndefined()
      const tokens = mod.highlightLines('import { readFileSync } from "node:fs"\nconst x: number = 42 // 注释\n', 'typescript')
      expect(tokens).toBeDefined()
      expect(tokens).toHaveLength(2)
      const colors = new Set(tokens!.flat().map((t) => t.style.color))
      expect(colors.size).toBeGreaterThan(1)
      for (const color of colors) {
        expect(color).toMatch(/^var\(--shiki-/)
      }
    } finally {
      await probe.cleanup()
    }
  })
})
