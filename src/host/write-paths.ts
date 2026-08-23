/**
 * 写路径提取:从"平台写意图"与 bash 命令串提取 agent 写入的文件路径。
 *
 * 纯业务层:零框架依赖;`ToolPresenter` 为注入面(适配层将 dsh 的
 * `ctx.tools.get(name).presentCall/presentResult` 映射为 `ToolViewSlice`)。
 *
 * 提取源(按优先级):
 *   1. diff 卡:`locations[].path` + `diffs[].path`(write/edit 等平台自证);
 *   2. generic 写类卡(kind ∈ {edit, delete, move}):`locations[].path`;
 *   3. terminal 卡或 shell 工具名:对命令串做静态写目标启发式
 *      (重定向 / tee / sed -i / cp-mv / dd of=;动态构造 `$()`/glob/
 *      `find -exec`/`eval` 漏报 → 落回外部,无回归);
 *   4. args 兜底目录:工具名命中已知写工具表时,取 args 的路径字段
 *      (仅当 1-3 无输出时;目录从保守,避免读类工具误标)。
 *
 * 硬约束:所有路径归一化为 repo-relative,解析后落在仓库根之外 → 丢弃
 * (统计严格基于 git 版本管理,仓库外文件不纳入)。
 */

/**
 * 平台写意图的扁平化最小切片(适配层把 dsh ToolCallView 的各卡形状
 * 映射为本接口;未知卡字段一律剥掉)。业务层按 `card` 字符串分支。
 */
export interface ToolViewSlice {
  readonly card: string
  readonly kind?: string
  readonly title?: string
  readonly cwd?: string
  readonly locations?: readonly { readonly path: string }[]
  readonly diffs?: readonly { readonly path: string }[]
}

/**
 * 工具写意图解析面。`presentCall(name, args)` 返回视图切片;
 * 未知工具/无 presenter → undefined(业务层静默降级到后续源)。
 */
export interface ToolPresenter {
  presentCall(name: string, args: unknown): ToolViewSlice | undefined
}

/** generic 卡的写类 kind(读/搜索/执行/网络类排除)。 */
const WRITE_KINDS: ReadonlySet<string> = new Set(['edit', 'delete', 'move'])

/** shell 工具名:args.command 即命令串,与 terminal 卡同路处理。 */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set(['bash', 'pwsh', 'terminal', 'shell'])

/** args 兜底目录(已知 dsh 写工具;读类工具绝不入表)。文件路径字段优先序。 */
const ARGS_WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'delete', 'move', 'rename', 'mkdir', 'apply_diff', 'apply_patch', 'str-replace', 'multi_edit'])
const ARGS_PATH_FIELDS = ['file_path', 'new_path', 'path', 'target_path', 'source_path', 'destination', 'directory'] as const

/** generic 卡的写类判定。 */
export function isWriteKind(kind: string | undefined): boolean {
  return kind !== undefined && WRITE_KINDS.has(kind)
}

/**
 * 从一个 turn 的工具调用提取写路径(repo-relative,去重,保序)。
 * @param name     工具名
 * @param argsJson 模型原文 args JSON
 * @param repoRoot 仓库根(绝对路径归一化基准)
 * @param presenter 平台写意图解析面;undefined 时跳过源 1-3
 */
export function extractWritePaths(
  name: string,
  argsJson: string,
  repoRoot: string,
  presenter: ToolPresenter | undefined,
): readonly string[] {
  let args: unknown
  try {
    args = JSON.parse(argsJson)
  } catch {
    args = null
  }
  const out = new Set<string>()
  const add = (raw: string): void => {
    const normalized = normalizeRepoPath(raw, repoRoot)
    if (normalized !== null) out.add(normalized)
  }

  // 源 1-3:平台写意图。
  const view = args !== null ? presenter?.presentCall(name, args) : undefined
  if (view?.card === 'diff') {
    for (const location of view.locations ?? []) add(location.path)
    for (const diff of view.diffs ?? []) add(diff.path)
  } else if (view?.card === 'generic' && isWriteKind(view.kind)) {
    for (const location of view.locations ?? []) add(location.path)
  }

  // 源 3b:shell 工具(terminal 卡或工具名命中)——命令串静态写目标启发式。
  const command = view?.card === 'terminal'
    ? view.title
    : (isShellName(name) && typeof args === 'object' && args !== null
        ? (args as { command?: unknown }).command
        : undefined)
  if (typeof command === 'string' && command !== '') {
    const cwd = view?.card === 'terminal' ? view.cwd : undefined
    for (const target of bashWriteTargets(command, cwd, repoRoot)) add(target)
  }

  // 源 4:args 兜底目录(仅当前面源全无输出时;保守——不熟的工具不猜)。
  if (out.size === 0 && args !== null && typeof args === 'object') {
    const record = args as Record<string, unknown>
    if (ARGS_WRITE_TOOLS.has(name)) {
      for (const field of ARGS_PATH_FIELDS) {
        const value = record[field]
        if (typeof value === 'string' && value !== '') add(value)
      }
    }
  }

  return [...out]
}

/**
 * 从 tool/result 的 meta(不透明 JSON)结构性提取 diff 路径(双源补充)。
 * 与 dsh FsDiffMeta `{ diffs: [{ path, oldText, newText }] }` 对齐,
 * 但为结构性判定,不依赖平台包。
 *
 * **必须归一化**(与 extractWritePaths 的 add() 同规):dsb 的 write/edit 工具
 * 直接把模型入参 `args.file_path` 投影为 diff paths——模型常传**绝对路径**。
 * 若不归一化,同一文件会以绝对/相对两个字符串进入 written Set,产出一条
 * 「已提交」+ 一条「仍变更」的重复记录(实测:git log 能解析仓库内绝对路径,
 * 绝对路径条目被权威探测标 committed,相对条目仍在 changes 标 dirty)。
 * 仓库外/非法路径丢弃(git-based 约束)。
 */
export function metaWritePaths(meta: unknown, repoRoot: string): readonly string[] {
  if (typeof meta !== 'object' || meta === null) return []
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return []
  const paths: string[] = []
  for (const diff of diffs) {
    if (typeof diff === 'object' && diff !== null) {
      const path = (diff as { path?: unknown }).path
      if (typeof path === 'string' && path !== '') {
        const normalized = normalizeRepoPath(path, repoRoot)
        if (normalized !== null) paths.push(normalized)
      }
    }
  }
  return paths
}

function isShellName(name: string): boolean {
  return SHELL_TOOL_NAMES.has(name)
}

/**
 * 路径归一化:绝对(POSIX `/` 或 Windows 盘符)→ repo-relative;
 * 相对 → 原样(仓库根即工作区);分隔符统一为 `/`。
 * 解析后落在仓库根之外或非法 → null(丢弃)。
 */
export function normalizeRepoPath(raw: string, repoRoot: string): string | null {
  let path = raw.trim()
  if (path === '') return null
  path = path.replaceAll('\\', '/')
  const absolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path)
  if (absolute) {
    const root = repoRoot.replaceAll('\\', '/').replace(/\/+$/, '')
    // 去掉盘符前缀与首斜杠,根与目标在同一基准下比较/裁剪。
    const target = path.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
    const base = root.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
    if (target === base) return null
    if (target.startsWith(`${base}/`)) {
      const relative = target.slice(base.length + 1)
      return relative === '' ? null : relative
    }
    return null // 出根(仓库外)——git-based 约束:丢弃
  }
  return collapseDots(path)
}

/** 折叠 `.` / `..` 段(dir/../file → file);`..` 逃逸出根 → null。 */
function collapseDots(path: string): string | null {
  const segments = path.split('/')
  const stack: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null // 逃逸出根
      stack.pop()
    } else {
      stack.push(segment)
    }
  }
  return stack.join('/')
}

// ── bash 命令串静态写目标启发式(方案 A;漏报落回外部,无回归) ──────────────

/**
 * 从 bash 命令串提取静态可解的写目标路径(repo-relative)。
 * 可解析模式:输出重定向(`>`/`>>`/`2>`/`&>`/`1>`)、内联重定向(`>file`)、
 * `tee`/`tee -a` 目标、`sed -i` 目标、`cp`/`mv`/`install` 目标、`dd of=`。
 * 不可静态解析(漏报,文档化):命令替换 `> $(name)`、glob 目标、
 * `find -exec`/`xargs`、`eval`/source、条件分支。
 */
export function bashWriteTargets(
  command: string,
  cwd: string | undefined,
  repoRoot: string,
): readonly string[] {
  const out = new Set<string>()
  const base = cwd ?? repoRoot
  const add = (token: string): void => {
    const resolved = resolveBashPath(token, base, repoRoot)
    if (resolved !== null) out.add(resolved)
  }
  const tokens = tokenizeShell(command)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    // 1. 独立重定向操作符 → 下一 token 是目标。
    if (isRedirect(token)) {
      const target = tokens[index + 1]
      if (target !== undefined) add(target)
      continue
    }
    // 2. 内联重定向:`>file`(操作符与路径粘连)。
    const inline = inlineRedirect(targetStr(token))
    if (inline !== null) {
      add(inline)
      continue
    }
    // 3. tee / tee -a:非选项参数到分隔符前。
    if (token === 'tee') {
      let cursor = index + 1
      while (cursor < tokens.length && /^-[^-]/.test(targetStr(tokens[cursor] ?? ''))) cursor += 1
      while (cursor < tokens.length && !isSeparator(tokens[cursor] ?? '')) {
        add(tokens[cursor] ?? '')
        cursor += 1
      }
      continue
    }
    // 4. sed -i / sed --in-place:最后非选项参数。
    if (token === 'sed' && /^(-i|--in-place)$/.test(targetStr(tokens[index + 1] ?? ''))) {
      const last = lastNonOptionArg(tokens, index + 2)
      if (last !== undefined) add(last)
      continue
    }
    // 5. cp / mv / install:最后非选项参数(目标)。
    if (token === 'cp' || token === 'mv' || token === 'install') {
      const last = lastNonOptionArg(tokens, index + 1)
      if (last !== undefined) add(last)
      continue
    }
    // 6. dd of=目标。
    if (/^of=/.test(targetStr(token))) {
      add(targetStr(token).slice(3))
    }
  }
  return [...out]
}

/** 判 redirect 操作符(引号内抑制——token 保引号,带引号字符不判)。 */
function isRedirect(token: string): boolean {
  if (hasQuote(token)) return false
  return /^(>>?|2>>?|&>>?|1>>?)$/.test(token)
}

/** 内联重定向 `>file`;引号内抑制。返回目标或 null。 */
function inlineRedirect(token: string): string | null {
  if (hasQuote(token)) return null
  const match = /^(?:>>?|2>>?|&>>?|1>>?)(.+)$/.exec(token)
  return match?.[1] ?? null
}

function isSeparator(token: string): boolean {
  if (hasQuote(token)) return false
  return /^[|;&>]$/.test(token)
}

function hasQuote(token: string): boolean {
  return token.includes('"') || token.includes("'")
}

/** 取分隔符前的最后一个非 `-` 前缀参数(引号内抑制分隔语义)。 */
function lastNonOptionArg(tokens: readonly string[], from: number): string | undefined {
  let last: string | undefined
  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || isSeparator(token)) break
    if (!startsWithDash(token)) last = token
  }
  return last
}

function startsWithDash(token: string): boolean {
  return token !== '' && token[0] === '-' && !hasQuote(token)
}

/** shell 目标归一化:绝对 → 对 repoRoot 归一;相对 → 对 bash 工作目录解析。
 * 目标 token 须为路径形态(无 shell 元字符/引号/操作符)——动态构造
 * (`$()`/glob/引号命令串)静态不可解,拒绝捕获(漏报落回外部,无回归)。 */
function resolveBashPath(target: string, base: string, repoRoot: string): string | null {
  const trimmed = target.trim().replace(/^['"]|['"]$/g, '')
  if (trimmed === '' || !isPathLike(trimmed)) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return normalizeRepoPath(trimmed, repoRoot)
  }
  const baseCleaned = base.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalizeRepoPath(`${baseCleaned}/${trimmed}`, repoRoot)
}

/** 保守路径形态:仅字母数字与 `._/-`(含空格的文件名须带引号,已剥离)。
 * shell 元字符(`$ \` * ? [ ] { } ( ) ; & | < > 引号)一律拒绝。 */
function isPathLike(value: string): boolean {
  return /^[A-Za-z0-9._/ -]+$/.test(value)
}

/** 剥离引号外壳(token 化保留引号以抑制操作符语义)。 */
function targetStr(token: string): string {
  return token.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * shell 命令 token 化:尊重单/双引号与反斜杠转义;
 * **引号保留在 token 内**(后续 isRedirect/hasQuote 据此抑制引号内操作符语义);
 * `;` `|` `&` 作为分隔符输出(启发式只关心其边界语义)。
 */
export function tokenizeShell(command: string): readonly string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote !== null) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    if (char === ';' || char === '|' || char === '&') {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      tokens.push(char)
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}