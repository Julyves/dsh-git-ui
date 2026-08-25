/** 详情弹窗样式（popup / commit / change / footer / feedback）。 */
import type { CSSProperties } from 'react'


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


/** 头部仓库路径行：root 段 flex 收缩 + 行尾齿轮槽（与路径同行，消除独立占行）。 */
export const popupHeaderRootRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}


/** 根路径行：文件夹图标 + 弱化省略路径。 */
export const popupHeaderRoot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flex: 1,
  minWidth: 0,
  color: 'var(--dsw-alias-label-tertiary)',
}


export const popupHeaderRootText: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
}


/** 头部分支内联切换按钮（无框融入头部，带 chevron 下拉）。 */
export const popupBranchMenu: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: 'none',
  background: 'transparent',
  padding: '2px 4px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: 4,
}


/** 紧凑状态条:发丝边 stat chips,**grid 三列两行**等宽对齐。
 * 6 格分两行——第一行工作区三态(已暂存/已修改/未跟踪),
 * 第二行同步与历史(已领先/已落后/上次提交);窄弹窗下不挤、不换行。 */
export const popupStatusBar: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
  marginBottom: 10,
}


/** 状态 chip:layer-2 底 + 发丝边 + 圆角 6(与 changeChip/行圆角同族)。
 * grid 项自动等宽;minWidth:0 + nowrap 防内部溢出/换行。 */
export const popupStatItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 3,
  justifyContent: 'center',
  minWidth: 0,
  padding: '3px 6px',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}


export const popupStatValue: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--dsw-alias-label-primary)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}


export const popupStatLabel: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}


/** 分支操作行（新建分支，上提至头部区下方）。 */
export const popupBranchOps: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
}


/** 分区小标题：macOS 分组节奏——上方 16px 弱发丝线 + 标题 11px semibold tertiary。
 * 区块边界由此线建立，信息带不再连续堆叠。 */
export const sectionTitle: CSSProperties = {
  margin: '14px 0 6px',
  paddingTop: 10,
  borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 55%, transparent)',
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


/** 变更文件名段：prominent，按需收缩（目录优先省略）。
 * 颜色由全局类控制（基础 label-primary / hover business-primary），否则内联
 * color 会压掉样式表的 :hover 主色。 */
export const changeNamePop: CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '60%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}


/** 变更文件名按钮（popup）：可点击打开 Git 中心 diff，hover 由全局类反馈。 */
export const changeNamePopBtn: CSSProperties = {
  ...changeNamePop,
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'left',
  cursor: 'pointer',
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


/** Inline error banner (panel-level; stays until dismissed or next action). */
export const feedbackError: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: '18px',
  // 淡晕背景 + 高对比文字（与 sbsDel/chip 同一配色语言）；
  // 旧用 state-error-secondary 饱和填充 + error-primary 同色系文字，
  // 对比度极低、文字几乎不可读。
  background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
  borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 120,
  overflowY: 'auto',
}


/** popup 告警横幅（emil §cohesion：告警而非 panic）：
 * 淡晕背景 + 高对比文字 + 左侧红色语义条 + 图标引导。
 * 与 popup 同一圆角/间距体系，不是「错误弹窗」是「内嵌告警」。 */
export const popupNote: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  margin: '8px 12px 0',
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: '18px',
  background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
  borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
  wordBreak: 'break-word',
}


/** 告警图标槽：error-primary 色，与左侧条同色呼应。 */
export const popupNoteIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-state-error-primary)',
  marginTop: 1,
}


/** 告警文案段：flex 收缩 + 省略兜底。 */
export const popupNoteText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  color: 'var(--dsw-alias-label-secondary)',
}


/** 告警行动按钮：error-primary 文字 + 无框（非 primary Button，内联轻量）。 */
export const popupNoteAction: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  padding: '2px 6px',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
  color: 'var(--dsw-alias-state-error-primary)',
  whiteSpace: 'nowrap',
}


/** 告警关闭按钮：弱化，不影响告警内容阅读。 */
export const popupNoteClose: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  border: 'none',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
  color: 'var(--dsw-alias-label-tertiary)',
  opacity: 0.7,
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

