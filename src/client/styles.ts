/**
 * Style constants for the git widget.
 *
 * Colors resolve exclusively through the host theme's `--dsw-alias-*` design
 * tokens (ui-theme design-platform.css), so the widget follows the active
 * light/dark theme automatically — never hard-coded surfaces. Layout mirrors
 * the official primitives: the pill is a 24px `Pill`-style chip, the popup a
 * `Menu`-surface card (border-l1, radius 12, shadow-lv3).
 *
 * The popup is a fixed-position card portaled to document.body (see
 * GitPill.tsx) — it must never participate in header layout, otherwise it
 * grows the header and distorts it.
 */
import type { CSSProperties } from 'react'

/** Pill: compact branch chip, right-aligned in the session header. */
export const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 8px',
  border: 0,
  borderRadius: 12,
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
}

/** Dimmed pill for degraded states (no repo / unavailable). */
export const pillDimmed: CSSProperties = {
  ...pill,
  opacity: 0.55,
  cursor: 'default',
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

/** Popup panel: fixed-position card (top/left come from the anchor math). */
export const popup: CSSProperties = {
  position: 'fixed',
  zIndex: 1100,
  boxSizing: 'border-box',
  width: 340,
  maxHeight: 420,
  overflowY: 'auto',
  padding: '10px 12px',
  fontSize: 12,
  lineHeight: '18px',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  boxShadow: 'var(--dsw-shadow-lv3)',
}

export const popupTitle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
}

export const rootLine: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-tertiary)',
  marginBottom: 8,
}

export const countGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 6,
  marginBottom: 8,
}

export const countCell: CSSProperties = {
  textAlign: 'center',
  padding: '4px 2px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}

export const countValue: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: 'var(--dsw-alias-label-primary)',
}

export const countLabel: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

export const sectionTitle: CSSProperties = {
  margin: '8px 0 4px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

export const commitRow: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'baseline',
  padding: '2px 0',
}

export const commitHash: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary)',
}

export const commitSubject: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  color: 'var(--dsw-alias-label-primary)',
}

export const commitMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
}

export const changeRow: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: '1px 0',
  borderRadius: 6,
}

export const changeChip: CSSProperties = {
  width: 20,
  textAlign: 'center',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  flexShrink: 0,
  color: '#fff',
}

export const changePath: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  color: 'var(--dsw-alias-label-primary)',
}

export const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 10,
}

export const checkedAt: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** Text button inside the popup (refresh). */
export const refreshButton: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: '2px 6px',
  fontSize: 12,
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  borderRadius: 6,
  font: 'inherit',
}

export const emptyNote: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  padding: '4px 0',
}

/**
 * Global styles for pseudo-class interactions (inline styles can't express
 * :hover/:focus-visible). Injected once per document under a plugin-scoped id.
 */
const GLOBAL_CSS_ID = 'dsh-git-status-pill/styles'

const globalCss = [
  '.dsh-git-status-pill__pill:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-git-status-pill__pill:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-status-pill__row { border-radius: 6px; }',
  '.dsh-git-status-pill__row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-git-status-pill__refresh:hover { color: var(--dsw-alias-state-business-primary); }',
  '.dsh-git-status-pill__refresh:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
].join('\n')

/** Ensure the global interaction styles exist (idempotent; browser only). */
export function ensureGlobalCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(GLOBAL_CSS_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = GLOBAL_CSS_ID
  tag.dataset.plugin = 'dsh-git-status-pill'
  tag.textContent = globalCss
  document.head.appendChild(tag)
}
