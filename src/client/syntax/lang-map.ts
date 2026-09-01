/**
 * 文件扩展名 / 文件名 → shiki 语言 id 映射（langOfPath 的单一事实来源）。
 *
 * 语言 id 集合与 `syntax/highlighter.ts` 注册的 grammar 一致；id 遵循
 * @shikijs/langs 的 grammar name（platform 的 read 工具同语义）。
 * 未知文件类型返回 undefined → 渲染层回落纯文本（不报错）。
 *
 * 预算取舍（单文件 bundle，grammar 依赖链以实际测量为准）：
 *   - ruby → 其 grammar 依赖图携带 cpp(817KB)/graphql/haml/JS 全家；
 *   - cpp(524KB) → 以 C grammar 近似（类/模板等语言特有结构回落纯文本）；
 *   - less(108KB) → 以 CSS grammar 近似；blade → php 的近邻（php grammar
 *     已注册，blade 自身也可注册——见 highlighter.ts）。
 * 近似取舍：超集语法的基础 token（关键字/字符串/注释/数字）正确，
 * 语言特有结构回落纯文本——对差异浏览的高亮需求足够。
 * 纯函数，可单元测试。
 */

/** 扩展名（含点、小写）→ 语言 id。 */
const EXTENSION_LANG: Readonly<Record<string, string>> = {
  // JS 家族（真实 grammar：html/vue 内嵌 script 依赖 javascript）
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // 数据 / 标记
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  // 前端模板 / 组件（html 真实 grammar——内嵌 <script>/<style> 正确着色；
  // vue/svelte/astro 为独立 grammar，含模板插值、style 变量注入等）
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.php': 'php',
  '.blade.php': 'blade',
  // 样式（scss 独立 grammar；less 以 CSS 近似）
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'css',
  // 脚本 / 通用语言（主机 diff 高频）
  '.py': 'python',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  // C++ 以 C grammar 近似（类/模板等语言特有结构回落纯文本）
  '.cpp': 'c',
  '.cc': 'c',
  '.cxx': 'c',
  '.hpp': 'c',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.sql': 'sql',
  // 新增：工程常用语言
  '.swift': 'swift',
  '.lua': 'lua',
  '.dart': 'dart',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.prisma': 'prisma',
  '.proto': 'proto',
  '.cmake': 'cmake',
  '.tf': 'terraform',
  '.hcl': 'hcl',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.v': 'verilog',
}

/** 精确文件名（无扩展名约定文件）→ 语言 id。 */
const FILENAME_LANG: Readonly<Record<string, string>> = {
  'dockerfile': 'dockerfile',
  'makefile': 'make',
  'cmakelists.txt': 'cmake',
}

/** 文件名前缀（如 Dockerfile.dev / Dockerfile.prod）→ 语言 id。 */
const FILENAME_PREFIX_LANG: Readonly<Record<string, string>> = {
  'dockerfile': 'dockerfile',
}

/** 取扩展名（含点）；点开头或纯名（无扩展）的文件返回 null。 */
function extensionOf(basename: string): string | null {
  const index = basename.lastIndexOf('.')
  if (index <= 0) return null
  return basename.slice(index).toLowerCase()
}

/**
 * 从路径推断高亮语言 id；无法推断返回 undefined（渲染层回落纯文本）。
 * 优先级：精确文件名 → 双段扩展名（.blade.php）→ 单扩展名 → 文件名前缀
 * （Dockerfile.dev 等变体）。
 */
export function langOfPath(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const basename = slash === -1 ? path : path.slice(slash + 1)
  const lower = basename.toLowerCase()
  const byName = FILENAME_LANG[lower]
  if (byName !== undefined) return byName
  // 双段扩展名优先（.blade.php → blade，不能落入 .php）
  const dot = lower.lastIndexOf('.')
  if (dot > 0) {
    const doubleExt = lower.slice(lower.lastIndexOf('.', dot - 1))
    if (doubleExt !== undefined && EXTENSION_LANG[doubleExt] !== undefined) {
      return EXTENSION_LANG[doubleExt]
    }
  }
  const extension = extensionOf(basename)
  if (extension !== null && EXTENSION_LANG[extension] !== undefined) return EXTENSION_LANG[extension]
  // 文件名前缀匹配（Dockerfile / Dockerfile.dev / Dockerfile.prod）
  for (const [prefix, lang] of Object.entries(FILENAME_PREFIX_LANG)) {
    if (lower === prefix || lower.startsWith(`${prefix}.`)) return lang
  }
  return undefined
}
