/**
 * 变更文件路径 → 可折叠目录树（IDEA 右栏文件树形态）。
 * 输入为 show 查询的 name-status 行（路径 + 变更状态），输出嵌套节点：
 * 目录在前、文件在后，同层按名称字母序；目录携带后代文件计数，
 * 文件节点携带状态（右栏按状态着色展示，不再显示 +/- 行数）。
 * 不依赖 React，可纯单元测试。
 */

/** 一个变更行（与宿主 GitFileStat 同构）。 */
export interface FileStatLike {
  readonly path: string
  readonly status: string
}

/** 目录树节点。 */
export interface FileTreeNode {
  /** 当前段名称（目录名或文件名）。 */
  readonly name: string
  /** 完整路径（目录 = 前缀路径，文件 = 文件路径）。 */
  readonly path: string
  readonly dir: boolean
  /** 目录节点的后代；文件节点恒为空。 */
  readonly children: readonly FileTreeNode[]
  /** 文件节点的变更状态；目录节点为 undefined。 */
  readonly status?: string
  /** 后代文件计数（文件 = 1，目录 = 后代和；IDEA 式「N 个文件」）。 */
  readonly count: number
}

interface MutableNode {
  name: string
  path: string
  dir: boolean
  children: Map<string, MutableNode>
  status?: string
  count: number
}

function newDirNode(name: string, path: string): MutableNode {
  return { name, path, dir: true, children: new Map(), count: 0 }
}

/** 由变更行列表构建目录树根节点集合。 */
export function buildFileTree(stats: readonly FileStatLike[]): readonly FileTreeNode[] {
  const root: MutableNode = newDirNode('', '')
  for (const stat of stats) {
    const segments = stat.path.split('/').filter((s) => s !== '')
    if (segments.length === 0) continue
    let cursor = root
    let prefix = ''
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      const isLast = i === segments.length - 1
      let next = cursor.children.get(segment)
      if (next === undefined) {
        next = isLast
          ? { name: segment, path: prefix, dir: false, children: new Map(), status: stat.status, count: 0 }
          : newDirNode(segment, prefix)
        cursor.children.set(segment, next)
      }
      cursor = next
    }
    // 沿路径向上累加文件计数（叶子在下方统一置 1）。
    let walk: MutableNode = root
    for (const segment of segments) {
      walk = walk.children.get(segment)!
      walk.count += 1
    }
  }
  return freeze(root.children)
}

/** 递归转换并排序：目录在前、文件在后，同层字母序。 */
function freeze(level: Map<string, MutableNode>): readonly FileTreeNode[] {
  const nodes: FileTreeNode[] = []
  for (const node of level.values()) {
    nodes.push({
      name: node.name,
      path: node.path,
      dir: node.dir,
      children: node.dir ? freeze(node.children) : [],
      ...(node.status === undefined ? {} : { status: node.status }),
      count: node.count,
    })
  }
  nodes.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}
