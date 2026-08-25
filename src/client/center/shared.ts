/**
 * GitCenter 跨 tab 共享：分组键/类型、排序工具、状态字母表、数值钳制。
 * 由 changes/ 与 history/ 子模块共享，避免重复定义。
 */
import type { GitChange } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'

/** Changes 分组键（IDEA 式三段：已暂存更改 / 更改 / 未版本控制的文件）。 */
export type ChangeGroupKey = 'staged' | 'unstaged' | 'untracked'

interface ChangeGroup {
  readonly key: ChangeGroupKey
  readonly labelKey: GitKey
  readonly items: readonly GitChange[]
}
export type { ChangeGroup }

/** 组内按路径字母序（IDEA 行为）。 */
export function byPath(a: GitChange, b: GitChange): number {
  return a.path.localeCompare(b.path)
}

/** 一条变更所属的分组键（IDEA 三段：已暂存/更改/未版本控制）。 */
export function groupKeyOfChange(c: GitChange): ChangeGroupKey {
  if (c.status === 'untracked') return 'untracked'
  return c.staged ? 'staged' : 'unstaged'
}

/** 数值钳制（Splitter 拖拽边界用）。 */
export function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

