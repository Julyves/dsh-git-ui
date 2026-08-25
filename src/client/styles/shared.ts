/** 跨域通用样式（空态 / 行操作槽）。 */
import type { CSSProperties } from 'react'


export const emptyNote: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  padding: '4px 0',
}


/** 空状态（弹窗紧凑版）：语义色小圆点 + 弱化文字，居中横排。 */
export const emptyStateSmall: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '10px 0 6px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}


/** 空状态圆点（视觉锚点）：8px 直径成功色（干净/未提交的正向语义）+ 发丝描边。
 * 亮色主题下灰面描边与弹窗底同白不可见——语义色保证两种主题均可读。 */
export const emptyStateDot: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-bg-layer-2))',
  boxShadow: 'inset 0 0 0 1.5px var(--dsw-alias-state-success-primary)',
}


/** 空状态（大区版）：图标容器 + 说明文字，居中纵排。 */
export const emptyState: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '20px 16px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}


/** 空状态图标容器：40px 圆形 layer-2 面 + 发丝边。 */
export const emptyStateIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 居中空状态占位（IDEA 式：大区空背景时中心显示提示文字）。 */
export const centeredEmpty: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
  padding: '16px 0',
}


/** 行尾操作槽：定宽右对齐（常驻占位，图标显隐由全局 CSS 控制，杜绝悬停布局跳动）。 */
export const rowActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 2,
  flex: 'none',
  width: 78,
}


/** 行操作图标按钮（24px 方形；交互态见全局 CSS）。
 * 基础色/底色由全局提供（.dsh-git-ui__icon-btn）：默认透明 + secondary，
 * :hover/:active 反馈得以渲染（内联会被其优先级压制）。 */
export const rowIconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  padding: 0,
}


/** 文件名前的轻量文件图标槽。 */
export const rowFileIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 右栏文件名按变更状态着色（IDEA 式：增绿/改蓝/删红/重命名蓝）。 */
export const statusTextColor: Record<string, string> = {
  added: 'var(--dsw-alias-state-success-primary)',
  untracked: 'var(--dsw-alias-state-success-primary)',
  modified: 'var(--dsw-alias-state-business-primary)',
  renamed: 'var(--dsw-alias-state-business-primary)',
  deleted: 'var(--dsw-alias-state-error-primary)',
  conflicted: 'var(--dsw-alias-state-error-primary)',
  typechange: 'var(--dsw-alias-state-warn-primary)',
}

