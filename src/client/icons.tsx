/**
 * 通用内联 SVG 图标（纯组件，currentColor 着色，明暗主题自适应）。
 * 取代文本符号/emoji（☁  ▸ 等），保证跨平台渲染一致且跟随语义令牌。
 */
import type { JSX } from 'react'

/** 折叠/展开箭头：open 时旋转 90°，带平台快速过渡。 */
export function ChevronIcon({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      style={{
        display: 'block',
        flex: 'none',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform var(--ds-transition-duration-fast) linear',
      }}
      aria-hidden="true"
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 目录图标（实心文件夹）。 */
export function FolderIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M1 3 a1 1 0 0 1 1-1 h2.6 l1.2 1.4 H10 a1 1 0 0 1 1 1 V9 a1 1 0 0 1-1 1 H2 a1 1 0 0 1-1-1 Z"
        fill="currentColor"
        opacity={0.75}
      />
    </svg>
  )
}

/** 文件图标（折角文档轮廓）。 */
export function FileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 分支图标（git branch）。 */
export function BranchIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <circle cx={3.5} cy={2.5} r={1.5} fill="currentColor" />
      <circle cx={3.5} cy={9.5} r={1.5} fill="currentColor" />
      <circle cx={8.5} cy={2.5} r={1.5} fill="currentColor" />
      <path d="M3.5 4 v4 M8.5 4 c0 2.5-2.5 2.5-4.5 3" fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}


/** 星形图标（默认/main 分支标识，IDEA 式）。 */
export function StarIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M6 0.8 l1.5 3.1 3.4 0.45 -2.5 2.35 0.65 3.35 L6 8.45 l-3.05 1.6 0.65-3.35 -2.5-2.35 3.4-0.45 Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 标签图标。 */
export function TagIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M1.5 1.5 h4 l5 5 l-4 4 l-5-5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <circle cx={3.8} cy={3.8} r={0.9} fill="currentColor" />
    </svg>
  )
}

