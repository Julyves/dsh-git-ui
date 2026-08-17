import { describe, expect, it } from 'vitest'
import { classifyDiffLine, parseUnifiedDiff } from '../../src/client/unified-diff.ts'

const SAMPLE = [
  'diff --git a/a.txt b/a.txt',
  'index 422c2b7..de98044 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,2 +1,3 @@',
  ' a',
  ' b',
  '+c',
  '-old',
  '',
].join('\n')

describe('classifyDiffLine', () => {
  it('classifies every line shape', () => {
    expect(classifyDiffLine('diff --git a/a b/a')).toBe('meta')
    expect(classifyDiffLine('index 422c2b7..de98044 100644')).toBe('meta')
    expect(classifyDiffLine('--- a/a.txt')).toBe('meta')
    expect(classifyDiffLine('+++ b/a.txt')).toBe('meta')
    expect(classifyDiffLine('new file mode 100644')).toBe('meta')
    expect(classifyDiffLine('Binary files a/x and b/x differ')).toBe('meta')
    expect(classifyDiffLine('@@ -1,2 +1,3 @@')).toBe('hunk')
    expect(classifyDiffLine('+added')).toBe('add')
    expect(classifyDiffLine('-removed')).toBe('del')
    expect(classifyDiffLine(' context')).toBe('context')
    expect(classifyDiffLine('+++not-a-header')).toBe('add')
    expect(classifyDiffLine('---not-a-header')).toBe('del')
  })
})

describe('parseUnifiedDiff', () => {
  it('parses a full sample preserving line order and types', () => {
    const lines = parseUnifiedDiff(SAMPLE)
    expect(lines.map((l) => l.type)).toEqual([
      'meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'context', 'add', 'del', 'context',
    ])
    expect(lines[4]).toEqual({ type: 'hunk', text: '@@ -1,2 +1,3 @@' })
    expect(lines[7]).toEqual({ type: 'add', text: '+c' })
    expect(lines[8]).toEqual({ type: 'del', text: '-old' })
  })

  it('returns an empty array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('handles multiple hunks and CRLF-free plain output', () => {
    const multi = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n@@ -5 +5 @@\n ctx\n'
    const lines = parseUnifiedDiff(multi)
    expect(lines.filter((l) => l.type === 'hunk')).toHaveLength(2)
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(1)
    expect(lines.filter((l) => l.type === 'del')).toHaveLength(1)
  })
})
