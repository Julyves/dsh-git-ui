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
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
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
  padding: '12px 14px',
  fontSize: 12,
  lineHeight: '18px',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  boxShadow: 'var(--dsw-shadow-lv3)',
}

/** 上下文头部：分支 prominent + 徽标 + 根路径（回响 pill 的分支/脏/同步信息）。 */
export const popupHeader: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingBottom: 10,
  marginBottom: 10,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

export const popupHeaderMain: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

/** 分支名：头部视觉重心（13px semibold primary）。 */
export const popupHeaderBranch: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

/** 头部徽标（脏状态 / 同步 / unborn）：次级弱化文本，不喧宾夺主。 */
export const popupBadge: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 根路径行：文件夹图标 + 弱化省略路径。 */
export const popupHeaderRoot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  color: 'var(--dsw-alias-label-tertiary)',
}

export const popupHeaderRootText: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
}

export const countGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  marginBottom: 10,
}

/** 计数格：层 2 淡底 + l2 发丝描边，与 pill 同一描边语言。 */
export const countCell: CSSProperties = {
  textAlign: 'center',
  padding: '6px 2px 5px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)',
}

export const countValue: CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

export const countLabel: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 分组小标题：macOS 式 11px semibold 弱化色（弃用全大写+字距的报表风）。 */
export const sectionTitle: CSSProperties = {
  margin: '14px 0 6px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 提交行：两段式（主题全宽 / hash·作者·时间 次行），消除窄弹窗内主题截断。 */
export const commitRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '3px 6px',
  margin: '0 -6px',
  borderRadius: 6,
}

export const commitHash: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary)',
}

/** 主题行：全宽省略，popup 内不再被 hash/meta 挤压。 */
export const commitSubjectPop: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
}

/** 次行元数据：hash · 作者 · 相对时间，弱化横排。 */
export const commitMetaLine: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
}

/** 元数据分隔点。 */
export const commitDot: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  opacity: 0.6,
}

export const commitMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
}

export const changeRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '2px 0',
  borderRadius: 6,
}

/** 状态字符徽标：紧凑方块芯片，小一号字 + 加粗，视觉重心更稳。 */
export const changeChip: CSSProperties = {
  width: 18,
  textAlign: 'center',
  borderRadius: 5,
  fontSize: 10,
  lineHeight: '14px',
  fontWeight: 700,
  flexShrink: 0,
}

/**
 * 状态字符徽标配色：color-mix 淡晕背景（~12%）+ label-primary 文字（始终高对比可读）。
 * 取代旧 state-*-secondary 饱和填充 + state-*-primary 文字（同色系 bg+text 低对比，如 added 绿底绿字看不清）。
 * 与差异视图 sbsDel/sbsAdd 同一配色语言。
 */
export const chipStyles: Record<string, CSSProperties> = {
  added: { background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)', color: 'var(--dsw-alias-label-primary)' },
  modified: { background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)', color: 'var(--dsw-alias-label-primary)' },
  deleted: { background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)', color: 'var(--dsw-alias-label-primary)' },
  renamed: { background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)', color: 'var(--dsw-alias-label-primary)' },
  untracked: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
  conflicted: { background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent)', color: 'var(--dsw-alias-label-primary)' },
  typechange: { background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)', color: 'var(--dsw-alias-label-primary)' },
}

/** 变更文件名段：prominent，按需收缩（目录优先省略）。 */
export const changeNamePop: CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '60%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
}

/** 变更目录段：弱化，flex:1 优先省略，文件名尽量完整。 */
export const changeDirPop: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 底栏：发丝分隔线把操作区与内容轻轻分开（macOS 工具栏语义）。 */
export const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 12,
  paddingTop: 10,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

/** 底栏操作组。 */
export const footerActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

/** 主操作（打开 Git 中心）：强调描边按钮，主题安全（不依赖未验证的 on-business 前景令牌）。 */
export const footerPrimary: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-state-business-primary)',
  color: 'var(--dsw-alias-state-business-primary)',
  fontWeight: 600,
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
  // Elevated 面滚动条重绑（宿主 scrollbar.css 契约：浮起表面须用 l2 滑块对，
  // 否则滑块底色与 layer-3 面同色而隐形）——popup / Git 中心 Modal / 自绘下拉。
  '.dsh-git-ui__pop, .dsh-git-ui__center, .dsh-git-ui__select-menu { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }',

  // 浮层入场（emil「勿从 scale(0) 入场」「浮层 origin-aware」）：
  // popup 默认下展 → top center；SelectMenu 始终按钮左下展 → top left。
  // @starting-style 无 JS 入场；不支持的引擎降级为瞬现（无功能回归）。
  '.dsh-git-ui__pop, .dsh-git-ui__select-menu { transition: opacity 150ms ease-out, transform 150ms ease-out; }',
  '.dsh-git-ui__pop { transform-origin: top center; }',
  '.dsh-git-ui__select-menu { transform-origin: top left; }',
  '.dsh-git-ui__pop, .dsh-git-ui__select-menu { opacity: 1; transform: scale(1); @starting-style { opacity: 0; transform: scale(0.97); } }',

  // ── 基础几何 + 过渡（含按压 transform，GPU 友好；禁用 transition: all）──────
  '.dsh-git-ui__row { border-radius: 6px; }',
  // 按压即时缩放：所有可按压元素 :active 时 scale(0.97)，松手回弹（emil「按钮必须可按压」）。
  '.dsh-git-ui__pill { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__commit-row, .dsh-git-ui__row { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__refresh { transition: transform var(--ds-transition-duration-fast) ease-out, color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 输入框 hover 反馈：边框由 l2 加深至 l1（聚焦环由 focus-visible 承担）。
  '.dsh-git-ui__branch-input, .dsh-git-ui__commit-input { transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // System tab underline: 2px bar below the active tab.
  '.dsh-git-ui__tab { transition: transform var(--ds-transition-duration-fast) ease-out, color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__tab::after { content: ""; position: absolute; right: 0; bottom: 1px; left: 0; height: 2px; border-radius: 2px; background: transparent; transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__tab--active::after { background: var(--dsw-alias-state-business-primary); }',
  // 工具栏下拉按钮：hover 淡底 + 缓动（与图标按钮同一交互语言）。
  '.dsh-git-ui__toolbar-select { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // IDEA 式悬停操作：行尾图标默认隐藏，悬停/键盘聚焦显现（元素常驻，无布局跳动）。
  '.dsh-git-ui__row-actions { opacity: 0; transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__row:focus-within .dsh-git-ui__row-actions { opacity: 1; }',
  // 行操作图标按钮的过渡。
  '.dsh-git-ui__icon-btn { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__icon-btn:disabled { opacity: 0.45; cursor: default; }',
  '.dsh-git-ui__diff-fold { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 底栏主操作过渡（按压缩放 + hover 淡底）。
  '.dsh-git-ui__footer-primary { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',

  // ── 按压态（:active，触屏与指针均触发，不闸控）────────────────────────
  // 仅叶子按钮缩放；.dsh-git-ui__row 是含 checkbox/按钮的容器行，:active 会向
  // 祖先传播——按压其子按钮会令整行缩放（非预期），故行级仅用底色反馈（见下条）。
  '.dsh-git-ui__pill:active, .dsh-git-ui__icon-btn:active, .dsh-git-ui__tab:active, .dsh-git-ui__refresh:active, .dsh-git-ui__toolbar-select:active, .dsh-git-ui__diff-fold:active, .dsh-git-ui__commit-row:active, .dsh-git-ui__footer-primary:active { transform: scale(0.97); }',
  '.dsh-git-ui__commit-row:active, .dsh-git-ui__row:active { background: var(--dsw-alias-interactive-bg-active); }',
  '.dsh-git-ui__icon-btn:active { background: var(--dsw-alias-interactive-bg-active); }',

  // ── 键盘焦点（始终可见，不闸控）──────────────────────────────────────
  '.dsh-git-ui__pill:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__commit-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__refresh:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
  '.dsh-git-ui__commit-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__branch-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; border-radius: 4px; }',
  '.dsh-git-ui__toolbar-select:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__diff-fold:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__footer-primary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',

  // Git center dialog: widen the platform Modal card (headless mode).
  '.dsh-git-ui__center { width: min(1200px, 100vw); height: min(760px, calc(100vh - 48px)); }',

  // ── 悬停态（仅指针设备，触屏 tap 不误激活——emil/apple 闸控规则）──────
  '@media (hover: hover) and (pointer: fine) {',
  '  .dsh-git-ui__pill:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__commit-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__splitter:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__refresh:hover { color: var(--dsw-alias-state-business-primary); }',
  '  .dsh-git-ui__branch-input:hover, .dsh-git-ui__commit-input:hover { border-color: var(--dsw-alias-border-l1); }',
  '  .dsh-git-ui__tab:hover { color: var(--dsw-alias-label-primary); }',
  '  .dsh-git-ui__toolbar-select:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }',
  '  .dsh-git-ui__icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
  '  .dsh-git-ui__diff-fold:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }',
  '  .dsh-git-ui__footer-primary:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__row:hover .dsh-git-ui__row-actions { opacity: 1; }',
  '}',

  // 触屏（无 hover）回退：行尾操作常驻显现，弥补 hover 闸控后触屏不可见的缺口。
  '@media (hover: none) { .dsh-git-ui__row-actions { opacity: 1; } }',

  // ── 减弱动效（保留辅助理解的透明度/颜色过渡，移除位移与缩放——apple 规则）──
  '@media (prefers-reduced-motion: reduce) {',
  '  .dsh-git-ui__pill, .dsh-git-ui__pop, .dsh-git-ui__select-menu, .dsh-git-ui__icon-btn, .dsh-git-ui__tab, .dsh-git-ui__commit-row, .dsh-git-ui__row, .dsh-git-ui__branch-input, .dsh-git-ui__commit-input, .dsh-git-ui__toolbar-select, .dsh-git-ui__diff-fold, .dsh-git-ui__refresh, .dsh-git-ui__footer-primary { transition: opacity 200ms ease, background 200ms ease, color 200ms ease, border-color 200ms ease !important; transform: none !important; }',
  '}',
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
  padding: '16px 20px 12px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  flex: 'none',
}

export const centerTitle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: '22px',
  fontWeight: 600,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-primary)',
}

export const centerBody: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

export const centerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  flexShrink: 0,
  padding: '0 8px',
  borderRadius: 6,
}

/** 差异对照激活行：淡底标识当前查看的文件（IDEA 选中行语义）。 */
export const centerRowActive: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
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

/** 行操作图标按钮（24px 方形、透明底；交互态见全局 CSS）。 */
export const rowIconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 24,
  height: 24,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  padding: 0,
  color: 'var(--dsw-alias-label-secondary)',
}

/** 文件名前的轻量文件图标槽。 */
export const rowFileIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * 文件名按钮（状态着色由行内注入）。
 * flex:'0 1 auto' + minWidth:0 + 封顶 65%：按需收缩、可省略；目录优先省略、
 * 文件名尽量完整（旧 maxWidth:55% 相对整行宽，短名也过度占位、挤压目录）。
 */
export const changeName: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'left',
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '65%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 行尾状态字母：无底色，IDEA 式单色字符。 */
export const statusLetter: CSSProperties = {
  flex: 'none',
  width: 14,
  textAlign: 'center',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  fontWeight: 600,
}

/** IDEA 式分组头：粘性吸顶，全选复选 + 折叠箭头 + 名称 + 计数。
 * 发丝级底部分隔（l2）让吸顶头与滚动内容轻轻分离，不产生重边框。 */
export const groupHeader: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  flexShrink: 0,
  padding: '0 8px',
  background: 'var(--dsw-alias-bg-layer-2)',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

/** 分组头折叠按钮（箭头 + 名称 + 计数一体可点）。 */
export const groupHeaderToggle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  fontWeight: 600,
  textAlign: 'left',
  color: 'var(--dsw-alias-label-secondary)',
}

/** 分组头计数（弱化）。 */
export const groupHeaderCount: CSSProperties = {
  fontWeight: 400,
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
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
  borderTop: '1px solid var(--dsw-alias-border-l2)',
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
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13,
  lineHeight: '20px',
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
  gap: 0,
}

export const changesRight: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderLeft: '1px solid var(--dsw-alias-border-l2)',
  paddingLeft: 12,
}

/** 变更行目录部分（弱化显示，与文件名同阶 12px，IDEA 同尺寸弱化）。 */
export const changeDir: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
}

// ── 并排差异对照 ───────────────────────────────────────────────────────

/**
 * 差异并排容器：双列独立横向滚动。
 * display:flex 横排两列；纵向单一滚动（overflow-y:auto）保证左右行同步对齐，
 * 横向不滚动（overflow-x:hidden）——每列各自 overflow-x:auto 独立滚动，
 * 内容只在本列展示，根治长行左右重叠。
 */
export const sbsContainer: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  overflowY: 'auto',
  overflowX: 'hidden',
  alignItems: 'flex-start',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  lineHeight: '18px',
}

/** 差异列（左/右各一）：独立横向滚动，纵向不滚动（由容器统一滚动）。 */
export const sbsCol: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
}

/** 右列：左侧发丝分隔线（取代旧 sbsCellRight 的单元格边框）。 */
export const sbsColRight: CSSProperties = {
  borderLeft: '1px solid var(--dsw-alias-border-l2)',
}

/**
 * 列内容包装：width:max-content 使长行撑宽触发本列横向滚动；
 * min-width:100% 使短行背景填满列宽。两列独立，互不重叠。
 */
export const sbsColInner: CSSProperties = {
  minWidth: '100%',
  width: 'max-content',
}

/** 差异行单元格：填满列内宽（width:100%），背景覆盖整行——根治滑动后同行后半段无配色。 */
export const sbsCell: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  gap: 6,
  padding: '0 8px',
  whiteSpace: 'pre',
  width: '100%',
}

/** 代码文本段：pre 不换行、flex:none 不收缩（保持原始列宽，不被压缩）。 */
export const sbsCode: CSSProperties = {
  whiteSpace: 'pre',
  flex: 'none',
}

/** 行号槽：定宽右对齐 + 右侧发丝线，数字与代码间留 8px 呼吸。 */
export const sbsNum: CSSProperties = {
  flex: 'none',
  width: 36,
  textAlign: 'right',
  paddingRight: 8,
  marginRight: 2,
  color: 'var(--dsw-alias-label-tertiary)',
  userSelect: 'none',
  borderRight: '1px solid var(--dsw-alias-border-l2)',
}

/**
 * 差异行配色（IDEA 式：低饱和淡晕背景 + 始终可读的文字）。
 * 旧实现用 state-*-secondary 饱和填充作背景、state-*-primary 作文字色，
 * 同色系背景覆盖同色系文字，明暗主题下均低对比且与页面风格冲突。
 * 现以 color-mix 由语义令牌派生 ~12% 淡晕（主题自适应；旧引擎降级为透明，
 * 文字仍可读），文字统一 label-primary。
 */
export const sbsDel: CSSProperties = {
  background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
}

export const sbsAdd: CSSProperties = {
  background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
}

export const sbsEmpty: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1)',
}

// ── 差异工具栏（IDEA 式：基线徽标 + 路径 + 前后导航 + 关闭）──────────────

/** 差异面板工具栏。 */
export const diffToolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
  height: 32,
  padding: '0 2px',
}

/** 差异基线徽标（暂存区 / 工作区）：pill 同族的发丝描边小胶囊。 */
export const diffBaseBadge: CSSProperties = {
  flex: 'none',
  padding: '2px 8px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '14px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

/** 差异路径目录段（弱化、flex:1 优先省略，文件名尽量完整）。 */
export const diffPathDir: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 差异路径文件名段（强调）。 */
export const diffPathName: CSSProperties = {
  flex: 'none',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
}

/** 差异变更摘要芯片（+n −m，等宽）。 */
export const diffSummary: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  gap: 8,
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
}

export const diffSummaryAdd: CSSProperties = {
  color: 'var(--dsw-alias-state-success-primary)',
}

export const diffSummaryDel: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
}

/** 折叠条：可点击展开的「… N 行未变更」横条（发丝实线上下缘，层 1 淡底）。 */
export const diffFold: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 'none',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '20px',
  padding: '2px 8px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'center',
}

/** 提交区快捷键提示（等宽弱化）。 */
export const commitKbd: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

// ── Git center tabs (system tab spec: 13/16/500, 2px indicator) ───────────

export const tabs: CSSProperties = {
  display: 'flex',
  gap: 24,
  padding: '0 20px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
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
  padding: '4px 8px',
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

/** 嵌套层引导线（IDEA 式目录树竖线）：发丝级 l2，暗态下不喧宾夺主。 */
export const treeChildren: CSSProperties = {
  marginLeft: 12,
  borderLeft: '1px solid var(--dsw-alias-border-l2)',
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
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

export const toolbarSearch: CSSProperties = {
  flex: 1,
  minWidth: 80,
  border: '1px solid var(--dsw-alias-border-l2)',
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
  border: '1px solid var(--dsw-alias-border-l2)',
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
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
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
  border: '1px solid var(--dsw-alias-border-l2)',
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

/** 表头：粘性置顶，与行共用列模板（跨行对齐的表格契约）。
 * macOS 表头规范：11px semibold 弱化色（原 400 字重过轻，列名立不住）。 */
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
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  fontSize: 11,
  fontWeight: 600,
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
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
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
  padding: '1px 7px',
  borderRadius: 9,
  border: '1px solid',
  fontSize: 10,
  fontWeight: 500,
  lineHeight: '13px',
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
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  lineHeight: '17px',
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
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

export const commitDetailHeader: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '2px 0 10px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

export const commitDetailSubject: CSSProperties = {
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  wordBreak: 'break-word',
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
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 13,
  lineHeight: '20px',
  fontFamily: 'inherit',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}

export const branchSelect: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
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
