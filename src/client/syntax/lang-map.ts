/**
 * 文件扩展名 / 文件名 → shiki 语言 id 映射（langOfPath 的单一事实来源）。
 *
 * 语言 id 集合与 `syntax/highlighter.ts` 注册的 grammar 一致；id 遵循
 * @shikijs/langs 的 grammar name（platform 的 read 工具同语义）。
 * 未知文件类型返回 undefined → 渲染层回落纯文本（不报错）。
 *
 * 预算取舍（单文件 bundle，grammar 依赖链以实际测量为准）：
 *   - ruby → 其 grammar 依赖图携带 cpp(817KB)/graphql/haml/JS 全家；
 *   - html → 携带 JavaScript/jsx/tsx 全家（~570KB），以 xml 近似；
 *   - cpp(817KB)/php(118KB)/less(105KB)/swift(92KB) → 以近邻近似（C++→C、
 *     SCSS/LESS→CSS）或回落纯文本。
 * 近似取舍：超集语法的基础 token（关键字/字符串/注释/数字）正确，
 * 语言特有结构回落纯文本——对差异浏览的高亮需求足够。
 * 纯函数，可单元测试。
 */

/** 扩展名（含点、小写）→ 语言 id。 */
const EXTENSION_LANG: Readonly<Record<string, string>> = {
  // JS 家族（TS grammar 近似 tokenize，与 platform 同一取舍）
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
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
  // HTML 以 XML grammar 近似（超集：基础 tag / 属性 / 字符串 / 注释正确，
  // 内嵌 <script> 等语言特有结构回落纯文本）——避免 html.mjs 携带的
  // JavaScript 全家 grammar（~570KB）。
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  // 样式（SCSS/LESS 以 CSS grammar 近似——超集，基础 token 正确）
  '.css': 'css',
  '.scss': 'css',
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
}

/** 精确文件名（无扩展名约定文件）→ 语言 id。 */
const FILENAME_LANG: Readonly<Record<string, string>> = {
  'dockerfile': 'shellscript',
  'makefile': 'make',
}

/** 取扩展名（含点）；点开头或纯名（无扩展）的文件返回 null。 */
function extensionOf(basename: string): string | null {
  const index = basename.lastIndexOf('.')
  if (index <= 0) return null
  return basename.slice(index).toLowerCase()
}

/** 从路径推断高亮语言 id；无法推断返回 undefined（渲染层回落纯文本）。 */
export function langOfPath(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const basename = slash === -1 ? path : path.slice(slash + 1)
  const byName = FILENAME_LANG[basename.toLowerCase()]
  if (byName !== undefined) return byName
  const extension = extensionOf(basename)
  if (extension === null) return undefined
  return EXTENSION_LANG[extension]
}
