/**
 * 左右对照构建测试：上下文对齐、删增配对、空位补齐、行号起算、全增文件。
 */
import { describe, expect, it } from 'vitest'
import { buildSideBySide, buildStream, capSideBySideRows, extractAddedContent, extractDeletedContent, foldContext, foldMarkerLines, foldStream, isAddOnlyDiff, isBinaryDiff, isDeleteOnlyDiff, streamMarkerLines, summarizeChanges, type DiffBlock, type SideBySideRow } from '../../src/client/side-by-side.ts'

describe('buildSideBySide', () => {
  it('returns an empty list for empty input', () => {
    expect(buildSideBySide('')).toEqual([])
  })

  it('aligns context lines on both sides with running numbers', () => {
    const rows = buildSideBySide([
      'diff --git a/x.txt b/x.txt',
      'index 111..222 100644',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
    ].join('\n'))
    expect(rows).toEqual([
      { left: { num: 1, text: 'one', kind: 'context' }, right: { num: 1, text: 'one', kind: 'context' } },
      { left: { num: 2, text: 'two', kind: 'del' }, right: { num: 2, text: 'TWO', kind: 'add' } },
      { left: { num: 3, text: 'three', kind: 'context' }, right: { num: 3, text: 'three', kind: 'context' } },
    ])
  })

  it('pairs uneven del/add blocks with empty cells', () => {
    const rows = buildSideBySide([
      '@@ -1,2 +1,3 @@',
      '-a',
      '-b',
      '+A',
      '+B',
      '+C',
    ].join('\n'))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ left: { num: 1, text: 'a', kind: 'del' }, right: { num: 1, text: 'A', kind: 'add' } })
    expect(rows[2]).toEqual({ left: { num: null, text: '', kind: 'empty' }, right: { num: 3, text: 'C', kind: 'add' } })
  })

  it('renders a brand-new file as all-add rows starting at 1', () => {
    const rows = buildSideBySide([
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
    ].join('\n'))
    expect(rows).toEqual([
      { left: { num: null, text: '', kind: 'empty' }, right: { num: 1, text: 'hello', kind: 'add' } },
      { left: { num: null, text: '', kind: 'empty' }, right: { num: 2, text: 'world', kind: 'add' } },
    ])
  })

  it('resets line numbers per hunk header', () => {
    const rows = buildSideBySide([
      '@@ -10,1 +10,1 @@',
      ' old',
      '@@ -20,1 +20,1 @@',
      ' far',
    ].join('\n'))
    expect(rows[0]).toMatchObject({ left: { num: 10 }, right: { num: 10 } })
    expect(rows[1]).toMatchObject({ left: { num: 20 }, right: { num: 20 } })
  })
})

describe('capSideBySideRows', () => {
  const rows = buildSideBySide('@@ -1,2 +1,2 @@\n a\n-b\n+c\n')

  it('returns the rows unchanged when within the cap', () => {
    expect(capSideBySideRows(rows, rows.length)).toBe(rows)
    expect(capSideBySideRows(rows, rows.length + 10)).toBe(rows)
  })

  it('truncates to the first max rows when over the cap', () => {
    const capped = capSideBySideRows(rows, 1)
    expect(capped).toHaveLength(1)
    expect(capped[0]).toEqual(rows[0])
  })

  it('handles a large diff without losing the head', () => {
    const lines: string[] = ['@@ -1,5000 +1,5000 @@']
    for (let i = 0; i < 5000; i += 1) lines.push(` line ${i}`)
    const big = buildSideBySide(lines.join('\n'))
    const capped = capSideBySideRows(big, 2000)
    expect(capped).toHaveLength(2000)
    expect(capped[0]).toMatchObject({ left: { num: 1 }, right: { num: 1 } })
  })
})

describe('summarizeChanges', () => {
  it('counts adds and dels across paired and empty cells', () => {
    const rows = buildSideBySide([
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      ' same',
    ].join('\n'))
    expect(summarizeChanges(rows)).toEqual({ add: 1, del: 1 })
  })

  it('returns zeros for a pure-context diff', () => {
    const rows = buildSideBySide('@@ -1,2 +1,2 @@\n a\n b\n')
    expect(summarizeChanges(rows)).toEqual({ add: 0, del: 0 })
  })

  it('counts a full-add file (del-empty / add-only)', () => {
    const rows = buildSideBySide('@@ -0,0 +1,2 @@\n+one\n+two\n')
    expect(summarizeChanges(rows)).toEqual({ add: 2, del: 0 })
  })
})

describe('foldContext', () => {
  // 夹具配额自洽：n+1 上下文 + 1 新增 → 旧侧 n+1、新侧 n+2（真实 git 输出必一致）。
  const ctx = (n: number): string[] => [`@@ -1,${n + 1} +1,${n + 2} @@`, ' keep', ...Array.from({ length: n }, (_, i) => ` c${i}`), '+add']

  it('leaves short context runs (≤ threshold) inline', () => {
    const rows = buildSideBySide(ctx(2).join('\n'))
    const blocks = foldContext(rows, 3)
    expect(blocks.every((b) => b.kind === 'row')).toBe(true)
    expect(blocks).toHaveLength(rows.length)
  })

  it('folds a long context run into one fold block retaining the rows', () => {
    const rows = buildSideBySide(ctx(10).join('\n'))
    const blocks = foldContext(rows, 3)
    const fold = blocks.find((b) => b.kind === 'fold')
    expect(fold).toBeDefined()
    if (fold?.kind !== 'fold') return
    expect(fold.count).toBe(11) // 'keep' + 10 context lines form one run
    expect(fold.rows).toHaveLength(11)
    // 行块数 = 折叠块(1) + 末尾 add 行块(1)
    expect(blocks.filter((b) => b.kind === 'row')).toHaveLength(1)
  })

  it('folds each long run separately when changes separate them', () => {
    const rows = buildSideBySide([
      '@@ -1,10 +1,12 @@',
      ...Array.from({ length: 5 }, () => ' a'),
      '+first',
      ...Array.from({ length: 5 }, () => ' b'),
      '+second',
    ].join('\n'))
    const blocks = foldContext(rows, 3)
    expect(blocks.filter((b) => b.kind === 'fold')).toHaveLength(2)
  })

  it('threshold < 1 disables folding (all rows)', () => {
    const rows = buildSideBySide(ctx(50).join('\n'))
    expect(foldContext(rows, 0).every((b) => b.kind === 'row')).toBe(true)
  })

  it('returns an empty list for empty input', () => {
    expect(foldContext([], 3)).toEqual([])
  })
})

describe('isBinaryDiff', () => {
  it('detects the git binary marker', () => {
    expect(isBinaryDiff('Binary files a/x and b/x differ\n')).toBe(true)
  })

  it('returns false for ordinary diffs', () => {
    expect(isBinaryDiff('@@ -1,1 +1,1 @@\n-old\n+new\n')).toBe(false)
    expect(isBinaryDiff('')).toBe(false)
  })
})

describe('\\ No newline at end of file marker (line-number fix)', () => {
  it('skips the marker without advancing either side line number', () => {
    const rows = buildSideBySide([
      '@@ -1 +1,2 @@',
      '-x',
      '+line1',
      '+line2',
      '\\ No newline at end of file',
    ].join('\n'))
    // 删/增配对：2 行（左 1 / 右 1、2）；marker 若被当作 context 会多出
    // 一行且行号整体 +1——此处行号精确即证明被跳过。
    expect(rows).toHaveLength(2)
    expect(rows[0]?.left.num).toBe(1)
    expect(rows[0]?.right.num).toBe(1)
    expect(rows[1]?.right.num).toBe(2)
    expect(rows[1]?.left.kind).toBe('empty')
    for (const row of rows) {
      expect(row.left.text).not.toContain('No newline')
      expect(row.right.text).not.toContain('No newline')
    }
  })

  it('keeps the numbers correct when the marker follows a context hunk', () => {
    const rows = buildSideBySide([
      '@@ -1,2 +1,3 @@',
      ' one',
      '+two',
      '+three',
      '\\ No newline at end of file',
    ].join('\n'))
    expect(rows).toHaveLength(3)
    expect(rows[0]?.left.kind).toBe('context')
    expect(rows[2]?.right.num).toBe(3)
    expect(rows[2]?.right.kind).toBe('add')
  })
})

describe('isAddOnlyDiff（纯新增判定）', () => {
  const newFileDiff = [
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    'index 0000000..3e75765',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+aaa',
    '+bbb',
  ].join('\n')

  it('detects a new-file diff (--- /dev/null + add-only rows)', () => {
    expect(isAddOnlyDiff(newFileDiff)).toBe(true)
  })

  it('detects --no-index output for untracked files', () => {
    const noIndex = [
      'diff --git a/a.txt b/a.txt',
      'new file mode 100644',
      'index 0000000..dbee026',
      '--- /dev/null',
      '+++ b/a.txt',
      '@@ -0,0 +1,2 @@',
      '+aaa',
      '+bbb',
    ].join('\n')
    expect(isAddOnlyDiff(noIndex)).toBe(true)
  })

  it('returns false for a modified file', () => {
    const modified = [
      'diff --git a/x.txt b/x.txt',
      'index 111..222 100644',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')
    expect(isAddOnlyDiff(modified)).toBe(false)
  })

  it('returns false for a deletion / rename / empty input', () => {
    const deleted = [
      'diff --git a/x.txt b/x.txt',
      'deleted file mode 100644',
      '--- a/x.txt',
      '+++ /dev/null',
    ].join('\n')
    expect(isAddOnlyDiff(deleted)).toBe(false)
    const renamed = 'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt'
    expect(isAddOnlyDiff(renamed)).toBe(false)
    expect(isAddOnlyDiff('')).toBe(false)
  })
})

describe('extractAddedContent（纯新增内容提取）', () => {
  it('extracts the full file content without the diff wrapper', () => {
    const text = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+aaa',
      '+bbb',
    ].join('\n')
    expect(extractAddedContent(text)).toBe('aaa\nbbb')
  })

  it('drops the no-newline marker and returns empty for an empty file', () => {
    const text = [
      '--- /dev/null',
      '+++ b/e.txt',
      '@@ -0,0 +1 @@',
      '+',
      '\\ No newline at end of file',
    ].join('\n')
    expect(extractAddedContent(text)).toBe('')
    expect(extractAddedContent('')).toBe('')
  })
})

describe('foldMarkerLines（可见流坐标）', () => {
  const row = (kind: 'context' | 'add' | 'del' | 'empty'): SideBySideRow => ({
    left: { num: 1, text: '', kind: kind === 'del' ? 'del' : 'context' },
    right: { num: 1, text: '', kind: kind === 'add' ? 'add' : 'context' },
  })
  const fold = (count: number): DiffBlock => ({ kind: 'fold', count, rows: Array.from({ length: count }, () => row('context')) })

  it('places markers at their visible-flow position (unfolded rows do not occupy stream height)', () => {
    // blocks: [row, fold(5), row] → 折叠条在可见流的第 1 行之后（line=1）
    const blocks: readonly DiffBlock[] = [
      { kind: 'row', row: row('context') },
      fold(5),
      { kind: 'row', row: row('context') },
    ]
    const markers = foldMarkerLines(blocks, new Set())
    expect(markers).toEqual([{ index: 1, line: 1, count: 5 }])
  })

  it('advances the line offset past expanded folds', () => {
    const blocks: readonly DiffBlock[] = [
      { kind: 'row', row: row('context') },
      fold(5),
      fold(3),
    ]
    // 第一个折叠展开（占 5 行）→ 第二个折叠条位于可见流的 1+5=6 行处
    const markers = foldMarkerLines(blocks, new Set([1]))
    expect(markers).toEqual([{ index: 2, line: 6, count: 3 }])
  })

  it('returns empty when every fold is expanded', () => {
    const blocks: readonly DiffBlock[] = [fold(5), fold(2)]
    expect(foldMarkerLines(blocks, new Set([0, 1]))).toEqual([])
  })
})

describe('hunk 配额感知解析（C2 回归：++/-- 前缀内容行不得被当元信息丢弃）', () => {
  // 以下夹具均为真实 git 输出形态（2026-08-26 临时仓库实测）。
  const MODIFIED = [
    'diff --git a/f.txt b/f.txt',
    'index 22f0f67..b3fbe25 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,5 +1,6 @@',
    ' line1',
    '-++ foo',
    '+++ foo CHANGED',
    ' ++i;',
    ' -- bar',
    ' line5',
    '+more',
  ].join('\n')

  it('并排视图保留 ++ 开头的新增/删除行（diff 行 +++ foo / --- bar 与元信息同形）', () => {
    const rows = buildSideBySide(MODIFIED)
    // 「++ foo」→「++ foo CHANGED」的修改必须成对出现在对照行中。
    const pair = rows.find((r) => r.left.text === '++ foo')
    expect(pair).toBeDefined()
    expect(pair?.right.kind).toBe('add')
    expect(pair?.right.text).toBe('++ foo CHANGED')
    // 以 ++ 开头的未变更上下文行（++i;）双侧保留。
    const ctx = rows.find((r) => r.left.text === '++i;')
    expect(ctx?.right.text).toBe('++i;')
    // 汇总计数包含全部内容行：1 删 + 2 增。
    expect(summarizeChanges(rows)).toEqual({ add: 2, del: 1 })
  })

  it('删除行文本以 -- 开头时同样保留（--- bar 与 --- a/f 同形）', () => {
    const rows = buildSideBySide([
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1 @@',
      '--- bar to delete',
      ' keep',
    ].join('\n'))
    const del = rows.find((r) => r.left.text === '-- bar to delete')
    expect(del).toBeDefined()
    expect(del?.left.kind).toBe('del')
    expect(del?.right.kind).toBe('empty')
  })

  it('新文件视图提取内容不丢 ++ 开头的行（+++i; 是内容不是 +++ 元信息）', () => {
    const NEW_FILE = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..a3a0810',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,4 @@',
      '+a',
      '+++i;',
      '+++ space line',
      '+b',
    ].join('\n')
    expect(isAddOnlyDiff(NEW_FILE)).toBe(true)
    expect(extractAddedContent(NEW_FILE)).toBe('a\n++i;\n++ space line\nb')
  })
})

describe('isDeleteOnlyDiff（纯删除判定）', () => {
  it('detects a deleted file diff (+++ /dev/null + all-minus rows)', () => {
    const text = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      'index 111..000',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n')
    expect(isDeleteOnlyDiff(text)).toBe(true)
  })

  it('rejects ordinary modifications (has + content lines)', () => {
    const text = [
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n')
    expect(isDeleteOnlyDiff(text)).toBe(false)
  })

  it('rejects pure additions and renames', () => {
    const added = [
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,1 @@',
      '+hello',
    ].join('\n')
    expect(isDeleteOnlyDiff(added)).toBe(false)
    const renamed = [
      'diff --git a/a.txt b/b.txt',
      'rename from a.txt',
      'rename to b.txt',
    ].join('\n')
    expect(isDeleteOnlyDiff(renamed)).toBe(false)
  })

  it('detects an empty-file deletion (header only, no hunks)', () => {
    // git 对空文件删除只输出元信息头（无 ---/+++/@@），同样按删除分流。
    const text = [
      'diff --git a/empty.txt b/empty.txt',
      'deleted file mode 100644',
      'index e69de29..0000000',
    ].join('\n')
    expect(isDeleteOnlyDiff(text)).toBe(true)
  })

  it('returns false for empty input', () => {
    expect(isDeleteOnlyDiff('')).toBe(false)
  })
})

describe('extractDeletedContent（被删内容提取）', () => {
  it('extracts the full pre-delete content (old-side quota aware)', () => {
    const text = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-one',
      '-two',
      '-three',
    ].join('\n')
    expect(extractDeletedContent(text)).toBe('one\ntwo\nthree')
  })

  it('skips the no-newline marker and metadata lines', () => {
    const text = [
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-last',
      '\\ No newline at end of file',
      '-extra?',
    ].join('\n')
    // 配额 2：前两行 - 内容被消费；`\\` 标记跳过不占额。
    expect(extractDeletedContent(text)).toBe('last\nextra?')
  })

  it('returns empty string for an empty-file deletion', () => {
    const text = [
      'diff --git a/e.txt b/e.txt',
      'deleted file mode 100644',
    ].join('\n')
    expect(extractDeletedContent(text)).toBe('')
  })
})

describe('buildStream（单侧内容流）', () => {
  const rows = buildSideBySide([
    '@@ -1,4 +1,4 @@',
    ' ctx',
    '-del1',
    '-del2',
    '+add1',
    ' tail',
  ].join('\n'))

  it('before stream keeps context + del lines with old-side numbers', () => {
    expect(buildStream(rows, 'left')).toEqual([
      { num: 1, text: 'ctx', kind: 'context' },
      { num: 2, text: 'del1', kind: 'del' },
      { num: 3, text: 'del2', kind: 'del' },
      { num: 4, text: 'tail', kind: 'context' },
    ])
  })

  it('after stream keeps context + add lines with new-side numbers (no gaps)', () => {
    expect(buildStream(rows, 'right')).toEqual([
      { num: 1, text: 'ctx', kind: 'context' },
      { num: 2, text: 'add1', kind: 'add' },
      { num: 3, text: 'tail', kind: 'context' },
    ])
  })
})

describe('foldStream / streamMarkerLines（单流折叠）', () => {
  it('folds long context runs and marks their visible-stream position', () => {
    const lines = [
      { num: 1, text: 'a', kind: 'context' as const },
      { num: 2, text: 'b', kind: 'context' as const },
      { num: 3, text: 'c', kind: 'context' as const },
      { num: 4, text: 'd', kind: 'context' as const },
      { num: 5, text: '-x', kind: 'del' as const },
    ]
    const blocks = foldStream(lines, 3)
    expect(blocks).toEqual([
      { kind: 'fold', count: 4, lines: lines.slice(0, 4) },
      { kind: 'row', line: lines[4] },
    ])
    expect(streamMarkerLines(blocks, new Set())).toEqual([{ index: 0, line: 0, count: 4 }])

    // 展开后标记消失、全部行可见。
    expect(streamMarkerLines(blocks, new Set([0]))).toEqual([])
  })

  it('threshold < 1 disables folding', () => {
    const lines = [{ num: 1, text: 'a', kind: 'context' as const }]
    expect(foldStream(lines, 0)).toEqual([{ kind: 'row', line: lines[0] }])
  })

  it('merged context runs across removed opposite-side lines fold together', () => {
    // 变更行剔除后，两段上下文在流中合并为一段长 run —— 单流须独立折叠。
    const rows = buildSideBySide([
      '@@ -1,7 +1,6 @@',
      ' c1',
      ' c2',
      '-gone',
      ' c3',
      ' c4',
      ' c5',
      ' c6',
    ].join('\n'))
    const stream = buildStream(rows, 'right')
    expect(stream.every((l) => l.kind === 'context')).toBe(true)
    expect(stream).toHaveLength(6)
    const blocks = foldStream(stream, 3)
    expect(blocks).toEqual([{ kind: 'fold', count: 6, lines: stream }])
  })
})
