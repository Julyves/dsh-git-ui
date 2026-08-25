/**
 * 窗口化渲染（虚拟滚动）切片计算与钩子。
 *
 * 长列表/diff 视图全量渲染 DOM 会让节点数随行数线性增长，几千行即卡顿。
 * 本模块按「固定行高 + 可视窗 ±overscan」只渲染可见切片，上下以占位 div
 * 撑出真实滚动高度——DOM 规模与总行数解耦，只随视口高度变化。
 *
 * 模式与历史提交列表（GitCenter HistoryTab 的 windowSlice）同构，此处抽为
 * 可复用钩子供 diff 并排视图与新增文件视图共用。`computeWindow` 为纯函数，
 * 便于单测覆盖边界。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** 一个窗口切片：[start, end) 半开区间，含顶垫外的前后行（overscan）。 */
export interface WindowSlice {
  readonly start: number
  readonly end: number
}

/** 首屏初始渲染行数上限（覆盖一般视口 + overscan，避免首帧空白再补）。 */
const INITIAL_END = 60

/**
 * 由滚动位置计算窗口切片（纯函数）。
 *
 * @param scrollTop   滚动容器当前 scrollTop（px）
 * @param clientHeight 滚动容器可视高度（px）
 * @param total       总行数
 * @param rowHeight   固定行高（px）——窗口化的前提
 * @param overscan    视口上下额外渲染的行数（防快速滚动露出空白）
 * @returns 切片 [start, end)；total=0 时返回 {0,0}
 */
export function computeWindow(
  scrollTop: number,
  clientHeight: number,
  total: number,
  rowHeight: number,
  overscan: number,
): WindowSlice {
  if (total <= 0 || rowHeight <= 0 || clientHeight <= 0) return { start: 0, end: 0 }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(total, Math.ceil((scrollTop + clientHeight) / rowHeight) + overscan)
  // start 超过末尾（scrollTop 越界）：钉到末尾窗口，避免空切片。
  const safeStart = Math.min(start, Math.max(0, total - 1))
  const safeEnd = Math.max(safeStart, Math.min(total, end))
  return { start: safeStart, end: safeEnd }
}

/**
 * 窗口化渲染钩子：返回滚动容器 ref、当前切片、onScroll。
 *
 * `total` 变化（切换文件/展开折叠改变可见行数）时经 useLayoutEffect 重算切片，
 * 保证新内容就位即对齐当前滚动位置；切片未变时不触发重渲（setState 浅比较短路）。
 */
export function useWindowSlice(
  total: number,
  rowHeight: number,
  overscan = 10,
): {
  readonly ref: React.RefObject<HTMLDivElement | null>
  readonly slice: WindowSlice
  readonly onScroll: () => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [slice, setSlice] = useState<WindowSlice>({ start: 0, end: Math.min(INITIAL_END, Math.max(0, total)) })
  const onScroll = useCallback((): void => {
    const el = ref.current
    if (el === null) return
    const next = computeWindow(el.scrollTop, el.clientHeight, total, rowHeight, overscan)
    setSlice((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [total, rowHeight, overscan])
  // total 变化（文件切换/折叠展开）后立即重算，避免窗口与内容错位。
  useLayoutEffect(() => {
    onScroll()
  }, [onScroll])
  return { ref, slice, onScroll }
}
