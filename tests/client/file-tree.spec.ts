/**
 * 目录树构建测试：嵌套、排序（目录在前字母序）、状态挂载、文件计数、边界。
 */
import { describe, expect, it } from 'vitest'
import { buildFileTree, splitChangePath } from '../../src/client/file-tree.ts'

describe('buildFileTree', () => {
  it('returns an empty tree for no stats', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('keeps root files as leaf nodes with status', () => {
    const tree = buildFileTree([{ path: 'readme.md', status: 'modified' }])
    expect(tree).toEqual([
      { name: 'readme.md', path: 'readme.md', dir: false, children: [], status: 'modified' },
    ])
  })

  it('nests directories and attaches status to leaves', () => {
    const tree = buildFileTree([
      { path: 'src/a/x.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'added' },
      { path: 'root.txt', status: 'deleted' },
    ])
    // 目录在前：src 先于 root.txt。
    expect(tree.map((n) => n.name)).toEqual(['src', 'root.txt'])
    const src = tree[0]!
    expect(src.dir).toBe(true)
    // src 内：目录 a 先于文件 b.ts。
    expect(src.children.map((n) => n.name)).toEqual(['a', 'b.ts'])
    const a = src.children[0]!
    expect(a.children[0]).toMatchObject({ name: 'x.ts', dir: false, status: 'modified' })
  })

  it('sorts siblings alphabetically within dirs-first order', () => {
    const tree = buildFileTree([
      { path: 'z/x.txt', status: 'added' },
      { path: 'a.txt', status: 'added' },
      { path: 'z/b.txt', status: 'added' },
    ])
    expect(tree.map((n) => n.name)).toEqual(['z', 'a.txt'])
    expect(tree[0]!.children.map((n) => n.name)).toEqual(['b.txt', 'x.txt'])
  })

  it('merges shared prefixes into one directory chain', () => {
    const tree = buildFileTree([
      { path: 'deep/nested/one.txt', status: 'added' },
      { path: 'deep/nested/two.txt', status: 'modified' },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.name).toBe('deep')
    expect(tree[0]!.children[0]!.children).toHaveLength(2)
  })

  it('treats a trailing-slash entry as a directory node without status', () => {
    // git status 对未跟踪目录输出 `dir/`（尾斜杠）：`.agent/` 应为目录节点。
    const tree = buildFileTree([{ path: '.agent/', status: 'untracked' }])
    expect(tree).toEqual([{ name: '.agent', path: '.agent', dir: true, children: [] }])
  })
})

describe('splitChangePath', () => {
  it('splits a nested file into name + dir', () => {
    expect(splitChangePath('src/a.ts')).toEqual({ name: 'a.ts', dir: 'src', isDir: false })
  })

  it('keeps a root-level file flat', () => {
    expect(splitChangePath('u.txt')).toEqual({ name: 'u.txt', dir: '', isDir: false })
  })

  it('treats a dot-directory entry as a directory with a name (regression: .agent/)', () => {
    // 旧实现用裸 lastIndexOf('/')：`.agent/` → name=''、dir='.agent'，目录被当文件。
    expect(splitChangePath('.agent/')).toEqual({ name: '.agent', dir: '', isDir: true })
  })

  it('splits a nested directory entry', () => {
    expect(splitChangePath('sub/dir/')).toEqual({ name: 'dir', dir: 'sub', isDir: true })
  })

  it('honors the authoritative isDir flag even without a trailing slash (deep fix)', () => {
    // 根治：目录性由 host 解析字段权威标记（GitChange.isDirectory）驱动。
    // 即使路径规范化剥掉了尾斜杠（'.agent' 而非 '.agent/'），目录性不丢失。
    expect(splitChangePath('.agent', true)).toEqual({ name: '.agent', dir: '', isDir: true })
    expect(splitChangePath('sub/dir', true)).toEqual({ name: 'dir', dir: 'sub', isDir: true })
    // 显式 false 覆盖字符串派生（文件路径被误带尾斜杠的兜底：剥掉、按文件拆分）。
    expect(splitChangePath('.agent/', false)).toEqual({ name: '.agent', dir: '', isDir: false })
  })
})
