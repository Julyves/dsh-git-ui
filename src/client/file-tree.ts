/**
 * 变更文件路径 → 可折叠目录树（IDEA 右栏文件树形态）。
 * 输入为 show 查询的 name-status 行（路径 + 变更状态），输出嵌套节点：
 * 目录在前、文件在后，同层按名称字母序；文件节点携带状态（右栏按状态着色）。
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
}

interface MutableNode {
  name: string
  path: string
  dir: boolean
  children: Map<string, MutableNode>
  status?: string
}

function newDirNode(name: string, path: string): MutableNode {
  return { name, path, dir: true, children: new Map() }
}

/**
 * 变更路径 → 展示段拆分。git status 对未跟踪目录输出 `dir/`（尾斜杠）：
 * 目录必须剥掉尾斜杠后取末段为名、前缀为空，否则会把目录误当文件
 * （`.agent/` 用裸 lastIndexOf('/') 会得到空名 + `.agent` 目录段）。
 */
export function splitChangePath(path: string): { name: string; dir: string; isDir: boolean } {
  const isDir = path.endsWith('/')
  const display = isDir ? path.slice(0, -1) : path
  const slash = display.lastIndexOf('/')
  return slash === -1
    ? { name: display, dir: '', isDir }
    : { name: display.slice(slash + 1), dir: display.slice(0, slash), isDir }
}

/** 由变更行列表构建目录树根节点集合。 */
export function buildFileTree(stats: readonly FileStatLike[]): readonly FileTreeNode[] {
  const root: MutableNode = newDirNode('', '')
  for (const stat of stats) {
    // 尾斜杠 = 目录条目（git status 未跟踪目录形态）：末段按目录节点处理。
    const isDir = stat.path.endsWith('/')
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
          ? { name: segment, path: prefix, dir: isDir, children: new Map(), ...(isDir ? {} : { status: stat.status }) }
          : newDirNode(segment, prefix)
        cursor.children.set(segment, next)
      }
      cursor = next
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
    })
  }
  nodes.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}
