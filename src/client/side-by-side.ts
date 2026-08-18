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

/** 由 unified diff 文本构建对照行序列。空输入返回空数组。 */
export function buildSideBySide(unified: string): readonly SideBySideRow[] {
  if (unified === '') return []
  const rows: SideBySideRow[] = []
  let leftNum = 0
  let rightNum = 0
  let dels: string[] = []
  let adds: string[] = []

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
    if (line.startsWith('@@')) {
      flush()
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m !== null) {
        leftNum = Number(m[1]) - 1
        rightNum = Number(m[2]) - 1
      }
      continue
    }
    // 元信息行（diff --git / index / --- / +++ / new file 等）跳过。
    if (/^(diff --git|index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity index |rename from |rename to |Binary files |GIT binary patch)/.test(line)) {
      flush()
      continue
    }
    if (line.startsWith('-')) {
      if (adds.length > 0) flush()
      dels.push(line.slice(1))
      continue
    }
    if (line.startsWith('+')) {
      adds.push(line.slice(1))
      continue
    }
    // 上下文行（含空行：unified 的上下文行以空格开头；裸空行视为文件尾）。
    flush()
    if (line === '') continue
    const text = line.slice(1)
    rows.push({
      left: { num: (leftNum += 1), text, kind: 'context' },
      right: { num: (rightNum += 1), text, kind: 'context' },
    })
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

/** 判定二进制差异（git 输出 "Binary files … differ"，buildSideBySide 会跳过→空）。 */
export function isBinaryDiff(unified: string): boolean {
  return /^Binary files /m.test(unified)
}
