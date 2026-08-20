/**
 * popup 外部点击关闭判定（纯函数，不依赖 React——测试环境无宿主提供的 react）。
 *
 * 回归：popup 头部 SelectMenu 下拉 portaled 到 body（class `dsh-git-ui__select-menu`），
 * 点击其选项时 mousedown target 不在 popup 卡片内——旧实现误判为「点击外部」，
 * popup 在分支切换未及完成时关闭（分支看起来「没切换 + pill 自动关闭」）。
 */

/**
 * 外部 mousedown 是否应关闭 popup。命中 wrapper / popup 卡片、或其内部
 * portaled 浮层（`dsh-git-ui__select-menu`）视为内部交互，不关闭；其余外部点击关闭。
 */
export function shouldClosePopup(target: EventTarget | null, wrap: Node | null, pop: Node | null): boolean {
  if (target === null || !(target instanceof Node)) return true
  if (wrap !== null && wrap.contains(target)) return false
  if (pop !== null && pop.contains(target)) return false
  if (target instanceof Element && target.closest('.dsh-git-ui__select-menu') !== null) return false
  return true
}