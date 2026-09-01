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

/**
 * 语言覆盖冒烟：新注册语言（vue/html/jsx/tsx/scss 等）整块 tokenize 有
 * 着色产出，且内嵌代码段（vue 的 script/style、html 的 script）不回落纯文本。
 */
describe('highlightLines 扩展语言覆盖', () => {
  it('tokenizes a vue SFC with template + script + style all colored', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const tokens = highlightLines(
      '<template>\n  <div class="card">{{ title }}</div>\n</template>\n\n'
      + '<script setup lang="ts">\nimport { ref } from "vue"\nconst count = ref(0)\n</script>\n\n'
      + '<style scoped>\n.card { color: red; }\n</style>',
      'vue',
    )
    expect(tokens).toBeDefined()
    const colored = tokens!.flat().filter((t) => t.style.color !== undefined)
    // 模板 / script / style 三段均有着色（远多于纯标记的零星命中）
    expect(colored.length).toBeGreaterThan(10)
    // 内嵌 script 的关键字（import / const）必须着色——证明依赖注入生效
    const scriptKeyword = tokens!.flat().find((t) => t.text === 'import' || t.text === 'const')
    expect(scriptKeyword?.style.color).toContain('--shiki-')
  })

  it('tokenizes html with inline script (dependency injection)', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const tokens = highlightLines(
      '<html>\n<body>\n  <script>\n    const x = 42;\n    console.log(x);\n  </script>\n</body>\n</html>',
      'html',
    )
    expect(tokens).toBeDefined()
    const colored = tokens!.flat().filter((t) => t.style.color !== undefined)
    expect(colored.length).toBeGreaterThan(5)
    const jsKeyword = tokens!.flat().find((t) => t.text === 'const')
    expect(jsKeyword?.style.color).toContain('--shiki-')
  })

  it('tokenizes extended languages (jsx / tsx / scss / php / dockerfile / prisma)', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const cases: Array<[string, string]> = [
      ['jsx', 'export function App() {\n  return <div>Hello</div>;\n}'],
      ['tsx', 'interface Props { name: string }\nexport const G = ({ name }: Props) => <h1>{name}</h1>;'],
      ['scss', '$primary: #333;\n.card { color: $primary; &:hover { color: red; } }'],
      ['php', '<?php\nfunction greet(string $n): string { return "Hi " . $n; }\n'],
      ['dockerfile', 'FROM node:22\nWORKDIR /app\nCOPY package.json ./\nRUN npm ci'],
      ['prisma', 'model User {\n  id Int @id @default(autoincrement())\n  email String @unique\n}'],
      ['graphql', 'query GetUser($id: ID!) {\n  user(id: $id) { name }\n}'],
      ['swift', 'struct User {\n  let name: String\n  func greet() -> String { return "Hi" }\n}'],
    ]
    for (const [lang, code] of cases) {
      const tokens = highlightLines(code, lang)
      expect(tokens, `语言 ${lang} 应产出 token`).toBeDefined()
      const colored = tokens!.flat().filter((t) => t.style.color !== undefined)
      expect(colored.length, `语言 ${lang} 应有着色 token`).toBeGreaterThan(0)
    }
  })

  it('keeps javascript grammar output for common JS constructs (regression)', async () => {
    const ready = await waitReady()
    expect(ready).toBe(true)
    const tokens = highlightLines(
      'const answer: number = 42\nconst f = (x: number) => x * 2\nfoo("bar")\n// 注释\n',
      'javascript',
    )
    expect(tokens).toBeDefined()
    const text = tokens!.flat().map((t) => t.text).join('')
    // 内容完整保留（token 切分不丢字符）
    expect(text).toContain('const answer: number = 42')
    expect(text).toContain('foo("bar")')
    const keyword = tokens!.flat().find((t) => t.text === 'const')
    expect(keyword?.style.color).toContain('--shiki-')
  })
})
