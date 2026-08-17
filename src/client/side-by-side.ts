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
