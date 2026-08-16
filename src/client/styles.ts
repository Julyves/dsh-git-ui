/**
 * Inline style constants for the git widget. Deliberately plain CSS objects:
 * the standalone repo has no CSS-Modules build chain, and injecting style
 * tags would fight the module loader's plugin-owned style cleanup.
 */
import type { CSSProperties } from 'react'

/** Pill: compact branch chip, right-aligned in the session header. */
export const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 999,
  border: '1px solid var(--dsw-border-color, rgba(128,128,128,0.35))',
  background: 'var(--dsw-surface-2, rgba(128,128,128,0.12))',
  color: 'var(--dsw-text-1, inherit)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}

/** Dimmed pill for degraded states (no repo / unavailable). */
export const pillDimmed: CSSProperties = {
  ...pill,
  opacity: 0.55,
  cursor: 'default',
}

/** Popup panel. */
export const popup: CSSProperties = {
  width: 360,
  maxHeight: 420,
  overflowY: 'auto',
  padding: '10px 12px',
  fontSize: 12,
  background: 'var(--dsw-surface-1, #fff)',
  color: 'var(--dsw-text-1, inherit)',
  border: '1px solid var(--dsw-border-color, rgba(128,128,128,0.35))',
  borderRadius: 8,
  boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
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
  opacity: 0.75,
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
  borderRadius: 6,
  background: 'var(--dsw-surface-2, rgba(128,128,128,0.1))',
}

export const countValue: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
}

export const countLabel: CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
}

export const sectionTitle: CSSProperties = {
  margin: '8px 0 4px',
  fontSize: 11,
  fontWeight: 600,
  opacity: 0.75,
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
  opacity: 0.8,
}

export const commitSubject: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}

export const commitMeta: CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
  whiteSpace: 'nowrap',
}

export const changeRow: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: '1px 0',
}

export const changeChip: CSSProperties = {
  width: 20,
  textAlign: 'center',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  flexShrink: 0,
}

export const changePath: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
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
  opacity: 0.6,
}

export const emptyNote: CSSProperties = {
  opacity: 0.6,
  padding: '4px 0',
}
