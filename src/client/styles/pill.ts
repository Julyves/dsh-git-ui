/** 分支胶囊样式（pill / dot）。 */
import type { CSSProperties } from 'react'

/** Pill: compact branch chip, right-aligned in the session header.
 * macOS 式发丝描边（inset 无布局位移）：层 2 淡底 + l2 极细边，比纯底色更挺括。 */
export const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 9px',
  border: 0,
  borderRadius: 12,
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  maxWidth: 280,
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}


/** 分支名段：超长可省略，徽标优先保留。 */
export const pillBranch: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
  flexShrink: 1,
}


/** 徽标段:不截断,始终完整展示(+2 −1 ?3 / ↑1 ↓2)。 */
export const pillBadges: CSSProperties = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
}


/** Dimmed pill for degraded states (no repo / unavailable). */
export const pillDimmed: CSSProperties = {
  ...pill,
  opacity: 0.55,
  cursor: 'default',
}


/** 降级态图标槽（AlertIcon 弱化色）。 */
export const pillDimmedIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** Status dot: green when clean, warn when the tree is dirty. */
export const dot: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: 999,
  background: 'var(--dsw-alias-state-success-primary)',
}


export const dotDirty: CSSProperties = {
  ...dot,
  background: 'var(--dsw-alias-state-warn-primary)',
}

