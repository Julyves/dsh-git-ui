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
}

/** 状态字符徽标配色：全语义 token，明暗主题自适应（取代旧硬编码 hex）。 */
export const chipStyles: Record<string, CSSProperties> = {
  added: { background: 'var(--dsw-alias-state-success-secondary)', color: 'var(--dsw-alias-state-success-primary)' },
  modified: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-warn-primary)' },
  deleted: { background: 'var(--dsw-alias-state-error-secondary)', color: 'var(--dsw-alias-state-error-primary)' },
  renamed: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-business-primary)' },
  untracked: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
  conflicted: { background: 'var(--dsw-alias-state-error-secondary)', color: 'var(--dsw-alias-state-error-primary)' },
  typechange: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-warn-primary)' },
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
const GLOBAL_CSS_ID = 'dsh-git-ui/styles'

const globalCss = [
  '.dsh-git-ui__pill:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-git-ui__pill:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__row { border-radius: 6px; }',
  '.dsh-git-ui__row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  // 交互状态：平台动令过渡 + 按压态 + 键盘焦点可见性。
  '.dsh-git-ui__commit-row, .dsh-git-ui__row { transition: background var(--ds-transition-duration-fast) linear; }',
  '.dsh-git-ui__commit-row:active, .dsh-git-ui__row:active { background: var(--dsw-alias-interactive-bg-active); }',
  '.dsh-git-ui__row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__splitter:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-git-ui__refresh:hover { color: var(--dsw-alias-state-business-primary); }',
  '.dsh-git-ui__commit-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-git-ui__commit-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__refresh:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
  // Git center dialog: widen the platform Modal card (headless mode).
  '.dsh-git-ui__center { width: min(1200px, 100vw); height: min(760px, calc(100vh - 48px)); }',
  '.dsh-git-ui__commit-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  // System tab underline: 2px bar below the active tab.
  '.dsh-git-ui__tab::after { content: ""; position: absolute; right: 0; bottom: 1px; left: 0; height: 2px; border-radius: 2px; background: transparent; }',
  '.dsh-git-ui__tab--active::after { background: var(--dsw-alias-state-business-primary); }',
  '.dsh-git-ui__branch-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
].join('\n')

/** Ensure the global interaction styles exist (idempotent; browser only). */
export function ensureGlobalCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(GLOBAL_CSS_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = GLOBAL_CSS_ID
  tag.dataset.plugin = 'dsh-git-ui'
  tag.textContent = globalCss
  document.head.appendChild(tag)
}

// ── Git center (management panel) styles ──────────────────────────────────

export const centerShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

export const centerHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '18px 20px 12px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
  flex: 'none',
}

export const centerTitle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 500,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
}

export const centerBody: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

export const groupTitle: CSSProperties = {
  margin: '8px 0 4px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

export const centerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 8px',
  borderRadius: 8,
}

export const changeCheckbox: CSSProperties = {
  flex: 'none',
  accentColor: 'var(--dsw-alias-state-business-primary)',
}

export const toolRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  padding: '6px 0 2px',
}

export const commitBox: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l1)',
  padding: '12px 20px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 'none',
  marginTop: 'auto',
  background: 'var(--dsw-alias-bg-layer-1)',
}

export const commitInput: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 64,
  resize: 'vertical',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 14,
  lineHeight: '22px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}

export const commitFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

export const commitHint: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** Inline error banner (panel-level; stays until dismissed or next action). */
export const feedbackError: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: '18px',
  background: 'var(--dsw-alias-state-error-secondary)',
  color: 'var(--dsw-alias-state-error-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 120,
  overflowY: 'auto',
}

export const feedbackClose: CSSProperties = {
  flex: 'none',
  border: 0,
  background: 'transparent',
  padding: '0 2px',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  opacity: 0.7,
}

// ── Changes 双栏布局（IDEA 式：左列表 + 右对照）─────────────────────

export const changesLayout: CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 1,
  minHeight: 0,
}

export const changesLeft: CSSProperties = {
  flex: 'none',
  width: 340,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
}

export const changesList: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
}

export const changesRight: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderLeft: '1px solid var(--dsw-alias-border-l1)',
  paddingLeft: 12,
}

/** 变更行目录部分（弱化显示）。 */
export const changeDir: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
}

// ── 并排差异对照 ───────────────────────────────────────────────────────

export const sbsContainer: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: '18px',
}

export const sbsRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
}

export const sbsCell: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '0 8px',
  whiteSpace: 'pre',
  minWidth: 0,
}

export const sbsCellRight: CSSProperties = {
  borderLeft: '1px solid var(--dsw-alias-border-l1)',
}

export const sbsNum: CSSProperties = {
  flex: 'none',
  width: 32,
  textAlign: 'right',
  color: 'var(--dsw-alias-label-tertiary)',
  userSelect: 'none',
}

export const sbsDel: CSSProperties = {
  background: 'var(--dsw-alias-state-error-secondary)',
  color: 'var(--dsw-alias-state-error-primary)',
}

export const sbsAdd: CSSProperties = {
  background: 'var(--dsw-alias-state-success-secondary)',
  color: 'var(--dsw-alias-state-success-primary)',
}

export const sbsEmpty: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1)',
}

// ── Git center tabs (system tab spec: 13/16/500, 2px indicator) ───────────

export const tabs: CSSProperties = {
  display: 'flex',
  gap: 24,
  padding: '0 20px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
  flex: 'none',
}

export const tab: CSSProperties = {
  position: 'relative',
  padding: '0 0 11px',
  border: 'none',
  background: 'transparent',
  fontSize: 13,
  lineHeight: '16px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

/** Active-tab underline rides a pseudo-element (see global CSS). */
export const tabActive: CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
}

// ── History tab ───────────────────────────────────────────────────────────

/**
 * 历史行高：单一事实来源。行样式与分支图 SVG 共用该常量，
 * 保证条带占满整行、竖线在行间连续衔接（旧实现 36px 条带 vs 50px 行高导致虚线）。
 */
export const HISTORY_ROW_H = 32

export const historyLayout: CSSProperties = {
  display: 'flex',
  gap: 0,
  flex: 1,
  minHeight: 0,
}

/** 左栏滚动区（外壳 paneSide 提供宽/底/边线）。 */
export const historyTree: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 6,
  fontSize: 12,
  lineHeight: '20px',
}

export const treeGroupTitle: CSSProperties = {
  margin: '8px 0 2px',
  padding: '0 8px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 可折叠分组头（箭头 + 标题）。 */
export const treeSectionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  margin: '8px 0 2px',
  padding: '2px 8px',
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  textAlign: 'left',
  color: 'var(--dsw-alias-label-tertiary)',
}

export const treeRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '3px 8px',
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  textAlign: 'left',
  color: 'var(--dsw-alias-label-primary)',
}

export const treeRowActive: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-active)',
  color: 'var(--dsw-alias-state-business-primary)',
}

export const treeIcon: CSSProperties = {
  flex: 'none',
  width: 14,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 文件树折叠箭头槽（与叶子行隐藏占位对齐）。 */
export const treeCaret: CSSProperties = {
  flex: 'none',
  width: 10,
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 文件树图标槽。 */
export const treeFolderIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 右栏文件名按变更状态着色（IDEA 式：增绿/改蓝/删红/重命名琥珀）。 */
export const statusTextColor: Record<string, string> = {
  added: 'var(--dsw-alias-state-success-primary)',
  untracked: 'var(--dsw-alias-state-success-primary)',
  modified: 'var(--dsw-alias-state-business-primary)',
  renamed: 'var(--dsw-alias-state-warn-primary)',
  deleted: 'var(--dsw-alias-state-error-primary)',
  conflicted: 'var(--dsw-alias-state-error-primary)',
  typechange: 'var(--dsw-alias-state-warn-primary)',
}

/** 嵌套层引导线（IDEA 式目录树竖线）。 */
export const treeChildren: CSSProperties = {
  marginLeft: 12,
  borderLeft: '1px solid var(--dsw-alias-border-l1)',
}

export const treeName: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
}

export const treeNameCurrent: CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
  fontWeight: 600,
}

/** 中栏顶部工具栏：与左右 paneHead 同高同边线，组成统一头带。 */
export const historyToolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
  height: 40,
  padding: '0 8px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
}

export const toolbarSearch: CSSProperties = {
  flex: 1,
  minWidth: 80,
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '4px 10px',
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}

export const toolbarSelect: CSSProperties = {
  flex: 'none',
  maxWidth: 150,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
}

export const selectLabel: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
}

/** 自绘下拉菜单卡（平台 Menu 规范：layer-3 面 + l1 边 + lv3 阴影）。 */
export const selectMenu: CSSProperties = {
  position: 'fixed',
  zIndex: 1200,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 4,
  maxHeight: 280,
  overflowY: 'auto',
  background: 'var(--dsw-alias-bg-layer-3)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  boxShadow: 'var(--dsw-shadow-lv3)',
}

export const selectOption: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  textAlign: 'left',
  color: 'var(--dsw-alias-label-primary)',
}

export const selectOptionActive: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-state-business-primary)',
}

/** 无限滚动底部哨兵区。 */
export const loadSentinel: CSSProperties = {
  flex: 'none',
  padding: '8px 0',
  textAlign: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
}

/** 三pane 统一头带（40px，底边线对齐成带）。 */
export const paneHead: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 40,
  padding: '0 8px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
}

/** 左右侧栏外壳（淡底；分隔线按侧内联）。 */
export const paneSide: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

/** 左栏搜索框（分支或标签）。 */
export const treeSearch: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '3px 8px',
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}

/** 左栏搜索匹配文字高亮。 */
export const treeMatch: CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
  fontWeight: 600,
}

/** 头带小图标按钮（全部展开/收起等）。 */
export const paneHeadButton: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
}

/** 拖拽分割条：常驻发丝线（暗态可见）+ 悬停淡底提示可拖。 */
export const splitter: CSSProperties = {
  flex: 'none',
  width: 5,
  marginLeft: -3,
  cursor: 'col-resize',
  background: 'transparent',
  borderLeft: '1px solid var(--dsw-alias-border-l2)',
  zIndex: 1,
}

export const splitterRow: CSSProperties = {
  flex: 'none',
  height: 5,
  marginTop: -3,
  cursor: 'row-resize',
  background: 'transparent',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  zIndex: 1,
}

/** 中栏外壳：工具栏固定 + 滚动列表（工具栏不随列表滚动）。 */
export const historyColumn: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
}

export const historyList: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  paddingRight: 8,
}

/** 单行表格行：固定行高，图 + refs + 主题 + 哈希 + 作者 + 时间一行排布。
 * 列宽由组件内 gridTemplateColumns 注入（与表头共用同一模板）。
 * 行盒 = max(内容宽, 列表宽)：超宽图时撑开列表横向滚动区。 */
export const historyRow: CSSProperties = {
  display: 'grid',
  alignItems: 'center',
  alignSelf: 'flex-start',
  columnGap: 8,
  minWidth: '100%',
  width: 'auto',
  height: HISTORY_ROW_H,
  flexShrink: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

export const historyRowSelected: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-active)',
}

/** 表头：粘性置顶，与行共用列模板（跨行对齐的表格契约）。 */
export const historyHead: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'grid',
  alignItems: 'center',
  alignSelf: 'flex-start',
  columnGap: 8,
  minWidth: '100%',
  width: 'auto',
  height: 28,
  flexShrink: 0,
  padding: 0,
  background: 'var(--dsw-alias-bg-layer-2)',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 主题格：refs 胶囊 + 可省略主题文本。 */
export const historySubjectCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

export const commitSubjectLine: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

export const historyHash: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary)',
}

export const historyAuthor: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
}

export const historyTime: CSSProperties = {
  textAlign: 'right',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

// ── refs 胶囊（IDEA 分支标签风格）──────────────────────────────────────

/** 胶囊基样式；变体见 refPillHead / refPillBranch / refPillRemote / refPillTag。 */
export const refPill: CSSProperties = {
  flex: 'none',
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  padding: '0 6px',
  borderRadius: 8,
  border: '1px solid',
  fontSize: 10,
  lineHeight: '14px',
}

/** 当前分支（HEAD ->）：描边式胶囊（与列表标签胶囊同族，避免绿底绿字低对比）。 */
export const refPillHead: CSSProperties = {
  color: 'var(--dsw-alias-state-success-primary)',
  borderColor: 'var(--dsw-alias-state-success-primary)',
  background: 'transparent',
}

/** 其他本地分支：中性描边。 */
export const refPillBranch: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  borderColor: 'var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-2)',
}

/** 远程分支：弱化灰色。 */
export const refPillRemote: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  borderColor: 'var(--dsw-alias-border-l1)',
  background: 'transparent',
}

/** 标签：警示色描边。 */
export const refPillTag: CSSProperties = {
  color: 'var(--dsw-alias-state-warn-primary)',
  borderColor: 'var(--dsw-alias-state-warn-primary)',
  background: 'var(--dsw-alias-bg-layer-2)',
}

/** 右栏内容列（外壳 paneSide 提供宽/底/边线）。 */
export const historyRight: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingLeft: 12,
  overflowY: 'hidden',
}

export const rightFiles: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
}

export const rightMsg: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

/** 提交正文（等宽保留换行）。 */
export const msgBody: CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: '16px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--dsw-alias-label-secondary)',
}

/** 右栏未选中时的占位区（IDEA 式双区居中提示）。 */
export const rightEmptyZone: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}

/** 下占位区（提交详细信息）：固定比例 + 顶部分隔线。 */
export const rightEmptyZoneBottom: CSSProperties = {
  flex: 'none',
  height: '34%',
  borderTop: '1px solid var(--dsw-alias-border-l1)',
}

export const commitDetailHeader: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '2px 0 8px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
}

export const commitDetailSubject: CSSProperties = {
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

export const commitDetailMeta: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
}

// ── Branches 管理（popup）─────────────────────────────────────────────

/** popup 分支管理行。 */
export const branchManageRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
}

export const branchNameInput: CSSProperties = {
  flex: 1,
  minWidth: 120,
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 13,
  lineHeight: '20px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}

export const branchSelect: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  padding: '5px 8px',
  fontSize: 13,
  lineHeight: '20px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  maxWidth: 180,
}

export const branchMark: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-state-business-primary)',
  fontSize: 12,
}
