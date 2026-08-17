/**
 * 目录树构建测试：嵌套、排序（目录在前字母序）、stat 挂载、边界。
 */
import { describe, expect, it } from 'vitest'
import { buildFileTree } from '../../src/client/file-tree.ts'

describe('buildFileTree', () => {
  it('returns an empty tree for no stats', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('keeps root files as leaf nodes with stats', () => {
    const tree = buildFileTree([{ path: 'readme.md', added: 1, deleted: 0 }])
    expect(tree).toEqual([
      { name: 'readme.md', path: 'readme.md', dir: false, children: [], stat: { path: 'readme.md', added: 1, deleted: 0 }, added: 1, deleted: 0 },
    ])
  })

  it('nests directories and attaches stats to leaves', () => {
    const tree = buildFileTree([
      { path: 'src/a/x.ts', added: 2, deleted: 1 },
      { path: 'src/b.ts', added: 3, deleted: 0 },
      { path: 'root.txt', added: 1, deleted: 1 },
    ])
    // 目录在前：src 先于 root.txt。
    expect(tree.map((n) => n.name)).toEqual(['src', 'root.txt'])
    const src = tree[0]!
    expect(src.dir).toBe(true)
    // src 内：目录 a 先于文件 b.ts。
    expect(src.children.map((n) => n.name)).toEqual(['a', 'b.ts'])
    const a = src.children[0]!
    expect(a.children).toHaveLength(1)
    expect(a.children[0]).toMatchObject({ name: 'x.ts', dir: false, stat: { added: 2, deleted: 1 } })
    // 目录聚合后代计数（IDEA 式目录计数）。
    expect(src).toMatchObject({ added: 5, deleted: 1 })
    expect(a).toMatchObject({ added: 2, deleted: 1 })
  })

  it('sorts siblings alphabetically within dirs-first order', () => {
    const tree = buildFileTree([
      { path: 'z/x.txt', added: 0, deleted: 0 },
      { path: 'a.txt', added: 0, deleted: 0 },
      { path: 'z/b.txt', added: 0, deleted: 0 },
    ])
    expect(tree.map((n) => n.name)).toEqual(['z', 'a.txt'])
    expect(tree[0]!.children.map((n) => n.name)).toEqual(['b.txt', 'x.txt'])
  })

  it('merges shared prefixes into one directory chain', () => {
    const tree = buildFileTree([
      { path: 'deep/nested/one.txt', added: 1, deleted: 0 },
      { path: 'deep/nested/two.txt', added: 1, deleted: 0 },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.name).toBe('deep')
    expect(tree[0]!.children[0]!.children).toHaveLength(2)
  })
})
