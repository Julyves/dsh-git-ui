/**
 * Changes 差异视图的选择态协调（纯函数，可单元测试）。
 *
 * 快照变化后（轮询 / 管理操作成功），正在对照的文件可能消失，也可能在
 * 已暂存/未暂存两侧之间迁移（混合态拆分出的双条目）。
 * `reconcileDiffSelection` 给出视图应维持的选择态：
 *   - null           → 文件已不在变更清单，关闭对照；
 *   - 基线不变的选择 → 保持当前基线（MM 双条目优先复用原基线）；
 *   - 基线变更的选择 → 按文件当前所属侧重取。
 * 无论基线是否变化，调用方都应重取差异内容——操作可能刚改变了同一文件。
 */

/** 正在对照查看的文件（base 由打开行时的暂存态决定）。 */
export interface DiffSelection {
  readonly path: string
  readonly base: 'worktree' | 'staged'
}

/** 变更行结构面（与宿主 GitChange 同构）。 */
export interface ChangeLike {
  readonly path: string
  readonly status: string
  readonly staged: boolean
}

/** 变更行对应的差异基线：未跟踪与未暂存侧 → 工作区；已暂存侧 → 暂存区。 */
export function diffBaseOf(change: ChangeLike): 'worktree' | 'staged' {
  if (change.status === 'untracked') return 'worktree'
  return change.staged ? 'staged' : 'worktree'
}

/** 按新的变更清单协调当前选择态；语义见模块注释。 */
export function reconcileDiffSelection(
  selection: DiffSelection,
  changes: readonly ChangeLike[],
): DiffSelection | null {
  const entries = changes.filter((c) => c.path === selection.path)
  if (entries.length === 0) return null
  const sameBase = entries.find((c) => diffBaseOf(c) === selection.base)
  if (sameBase !== undefined) return { path: selection.path, base: selection.base }
  return { path: selection.path, base: diffBaseOf(entries[0]!) }
}

/**
 * 上一个/下一个更改的循环导航：`entries` 为导航序列（分组顺序），
 * `current` 为空时定位第一条；当前项不在序列中时按首项计；
 * `delta` 取 ±1（模长度循环，首尾相接）。空序列返回 null。
 */
export function stepDiffSelection(
  entries: readonly ChangeLike[],
  current: DiffSelection | null,
  delta: number,
): DiffSelection | null {
  if (entries.length === 0) return null
  if (current === null) {
    const first = entries[0]!
    return { path: first.path, base: diffBaseOf(first) }
  }
  const found = entries.findIndex((c) => c.path === current.path && diffBaseOf(c) === current.base)
  const index = found === -1 ? 0 : found
  const next = entries[(index + delta + entries.length) % entries.length]!
  return { path: next.path, base: diffBaseOf(next) }
}
