/**
 * 左右对照构建测试：上下文对齐、删增配对、空位补齐、行号起算、全增文件。
 */
import { describe, expect, it } from 'vitest'
import { buildSideBySide, capSideBySideRows } from '../../src/client/side-by-side.ts'

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
