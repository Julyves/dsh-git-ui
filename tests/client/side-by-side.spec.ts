/**
 * 左右对照构建测试：上下文对齐、删增配对、空位补齐、行号起算、全增文件。
 */
import { describe, expect, it } from 'vitest'
import { buildSideBySide, capSideBySideRows, foldContext, isBinaryDiff, summarizeChanges } from '../../src/client/side-by-side.ts'

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
  const rows = buildSideBySide('@@ -1,1 +1,1 @@\n a\n-b\n+c\n')

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
  const ctx = (n: number): string[] => ['@@ -1,1 +1,1 @@', ' keep', ...Array.from({ length: n }, (_, i) => ` c${i}`), '+add']

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
      '@@ -1,1 +1,1 @@',
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
