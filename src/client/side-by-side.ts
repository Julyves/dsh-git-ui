/**
 * unified diff → 左右对照行序列（IDEA 式并排查看）。
 * 上下文行两侧同号同文；删除/添加块按索引配对成行，
 * 长短不齐处以空位（empty）补齐；行号按 @@ 头起算。
 * 纯函数，可单元测试。
 */

/** 单侧单元格。num 为该行在旧/新文件中的行号；empty 侧 num 为 null。 */
export interface SideCell {
  readonly num: number | null
  readonly text: string
  readonly kind: 'context' | 'add' | 'del' | 'empty'
}

/** 一行对照：左 = 变更前，右 = 变更后。 */
export interface SideBySideRow {
  readonly left: SideCell
  readonly right: SideCell
}

/** 由 unified diff 文本构建对照行序列。空输入返回空数组。
 *
 * **hunk 配额感知解析**（C2 修复）：内容行与元信息行天然存在前缀歧义——
 * 行文本以 `++ `/`-- ` 开头时，diff 行（`+++ foo` / `--- bar`）与
 * `+++ b/path` / `--- a/f` 头部同形。按行首前缀判别会把这类内容行当元信息
 * 静默丢弃（并排视图整行消失/新文件视图丢内容）。权威判据是 @@ 头携带的
 * 行数配额：**首个 @@ 之前与配额耗尽之后**的行均为元信息（直接跳过）；
 * 配额在场时的 `-`/`+`/空格前缀行是内容行（`+++i;` 也是），按前缀分类
 * 并扣减对应侧配额（上下文行双侧各扣一）。`\ No newline` 标记与裸空行
 * 不扣配额。
 */
export function buildSideBySide(unified: string): readonly SideBySideRow[] {
  if (unified === '') return []
  const rows: SideBySideRow[] = []
  let leftNum = 0
  let rightNum = 0
  let dels: string[] = []
  let adds: string[] = []
  /** 当前 hunk 旧/新侧剩余内容行数（配额）。 */
  let oldLeft = 0
  let newLeft = 0
  let inHunk = false

  /** 将积累的删除/添加块按索引配对成对照行。 */
  const flush = (): void => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i += 1) {
      const d = dels[i]
      const a = adds[i]
      rows.push({
        left: d !== undefined ? { num: (leftNum += 1), text: d, kind: 'del' } : { num: null, text: '', kind: 'empty' },
        right: a !== undefined ? { num: (rightNum += 1), text: a, kind: 'add' } : { num: null, text: '', kind: 'empty' },
      })
    }
    dels = []
    adds = []
  }

  for (const line of unified.split('\n')) {
    // hunk 外（首个 @@ 之前 / 配额耗尽之后）：仅 @@ 头有意义，其余
    // （diff --git / index / --- / +++ / new file 等元信息与尾部空串）跳过。
    if (!inHunk || (oldLeft <= 0 && newLeft <= 0)) {
      inHunk = false
      if (line.startsWith('@@')) {
        flush()
        const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (m !== null) {
          leftNum = Number(m[1]) - 1
          rightNum = Number(m[3]) - 1
          oldLeft = m[2] !== undefined ? Number(m[2]) : 1
          newLeft = m[4] !== undefined ? Number(m[4]) : 1
          inHunk = true
        }
      }
      continue
    }
    // `\ No newline at end of file`：随被改行之后的**文件尾标记**，不是内容
    // 行——跳过且不得计入行号（旧实现会把它当上下文行使两侧行号整体 +1，错位）。
    if (line.startsWith('\\')) {
      flush()
      continue
    }
    if (line.startsWith('-')) {
      if (adds.length > 0) flush()
      dels.push(line.slice(1))
      oldLeft -= 1
      continue
    }
    if (line.startsWith('+')) {
      adds.push(line.slice(1))
      newLeft -= 1
      continue
    }
    // 上下文行（unified 的上下文行以空格开头；裸空行视为文件尾）。
    flush()
    if (line === '') {
      inHunk = false
      continue
    }
    const text = line.slice(1)
    rows.push({
      left: { num: (leftNum += 1), text, kind: 'context' },
      right: { num: (rightNum += 1), text, kind: 'context' },
    })
    oldLeft -= 1
    newLeft -= 1
  }
  flush()
  return rows
}

/** 渲染截断：超大差异仅保留前 max 行（防万行级 diff 卡死渲染）。 */
export function capSideBySideRows(rows: readonly SideBySideRow[], max: number): readonly SideBySideRow[] {
  return rows.length > max ? rows.slice(0, max) : rows
}

/** 判定一行为上下文行（两侧皆 context）。 */
function isContextRow(row: SideBySideRow): boolean {
  return row.left.kind === 'context' && row.right.kind === 'context'
}

/** 折叠块：连续上下文行超阈值时折叠为单个可展开标记，保留原行供展开。 */
export interface DiffFoldBlock {
  readonly kind: 'fold'
  readonly count: number
  readonly rows: readonly SideBySideRow[]
}

/** 普通行块。 */
export interface DiffRowBlock {
  readonly kind: 'row'
  readonly row: SideBySideRow
}

/** 差异渲染块：普通行或折叠块（按 kind 判别）。 */
export type DiffBlock = DiffRowBlock | DiffFoldBlock

/**
 * 折叠连续上下文行：超 threshold 的连续 context 段折叠为单个 fold 块
 * （保留原行供查看器展开）；不超过阈值则原样保留。threshold < 1 视为不折叠。
 * 纯函数，可单测。
 */
export function foldContext(rows: readonly SideBySideRow[], threshold = 3): readonly DiffBlock[] {
  if (threshold < 1) return rows.map((row) => ({ kind: 'row' as const, row }))
  const blocks: DiffBlock[] = []
  let i = 0
  while (i < rows.length) {
    if (!isContextRow(rows[i]!)) {
      blocks.push({ kind: 'row', row: rows[i]! })
      i += 1
      continue
    }
    let j = i
    while (j < rows.length && isContextRow(rows[j]!)) j += 1
    const run = rows.slice(i, j)
    if (run.length > threshold) {
      blocks.push({ kind: 'fold', count: run.length, rows: run })
    } else {
      for (const row of run) blocks.push({ kind: 'row', row })
    }
    i = j
  }
  return blocks
}

/** 统计增删行数（左 del + 右 add）。纯函数。 */
export function summarizeChanges(rows: readonly SideBySideRow[]): { readonly add: number; readonly del: number } {
  let add = 0
  let del = 0
  for (const row of rows) {
    if (row.left.kind === 'del') del += 1
    if (row.right.kind === 'add') add += 1
  }
  return { add, del }
}

/**
 * 折叠标记在**可见渲染流**中的坐标：未展开折叠块不占流（其后行自动上移），
 * 标记的 `line` 是其逻辑插入点之前的可见行数——渲染层按 `line × 行高`
 * 绝对定位，精确落在被剔除行的空档处：不遮挡任何内容、多折叠各自就位。
 * 展开的折叠块按全量行数推进（其行真实渲染）。纯函数，可单元测试。
 */
export function foldMarkerLines(
  blocks: readonly DiffBlock[],
  expanded: ReadonlySet<number>,
): readonly { readonly index: number; readonly line: number; readonly count: number }[] {
  const out: Array<{ index: number; line: number; count: number }> = []
  let visible = 0
  blocks.forEach((block, index) => {
    if (block.kind === 'fold') {
      if (expanded.has(index)) {
        visible += block.rows.length
      } else {
        out.push({ index, line: visible, count: block.rows.length })
      }
    } else {
      visible += 1
    }
  })
  return out
}

/**
 * 从纯新增差异中提取创建后的完整文件内容（去掉 diff 包装与元信息行）。
 * 仅对 `isAddOnlyDiff` 成立的文本调用；`\ No newline at end of file`
 * 标记行被跳过（它不是内容）。空文件返回 ''。
 *
 * hunk 配额感知（C2 修复）：`+++` 前缀既可能是 `+++ b/path` 元信息，也可能
 * 是 `++` 开头的内容行（如 `+++i;`）——按 @@ 头的新侧行数配额消费 `+` 行，
 * 配额外（首个 @@ 之前/配额耗尽之后）一律视为元信息跳过。
 */
export function extractAddedContent(unified: string): string {
  const out: string[] = []
  let newLeft = 0
  for (const line of unified.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      newLeft = m === null ? 0 : m[4] !== undefined ? Number(m[4]) : 1
      continue
    }
    if (line.startsWith('\\')) continue
    if (newLeft > 0 && line.startsWith('+')) {
      out.push(line.slice(1))
      newLeft -= 1
    }
  }
  return out.join('\n')
}

/** 判定二进制差异（git 输出 "Binary files … differ"，buildSideBySide 会跳过→空）。 */
export function isBinaryDiff(unified: string): boolean {
  return /^Binary files /m.test(unified)
}

/**
 * 判定一次差异为「纯新增」（文件创建，无任何历史侧内容）。
 *
 * 依据（git 输出的权威形态）：
 *   - 元信息含 `--- /dev/null`（new file / --no-index 与 /dev/null 对比均为
 *     此形态）且无 `deleted file mode` / `rename from`；
 *   - 不存在任何内容删除行（`-` 前缀且非 `---` 元信息）；
 *   - 所有 hunk 旧侧均为 `-0,0`（起始 0 且行数 0）。
 *
 * 满足时 UI 无需并排对照——直接展示创建后的完整文件内容（单栏全宽）。
 */
export function isAddOnlyDiff(unified: string): boolean {
  if (unified === '') return false
  let sawNullSource = false
  for (const line of unified.split('\n')) {
    if (line.startsWith('deleted file mode') || line.startsWith('rename from') || line.startsWith('rename to')) return false
    if (line.startsWith('--- /dev/null')) {
      sawNullSource = true
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) return false
  }
  if (!sawNullSource) return false
  for (const match of unified.matchAll(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/gm)) {
    const oldStart = match[1]
    const oldCount = match[2]
    if (oldStart !== '0' || oldCount !== '0') return false
  }
  return true
}
