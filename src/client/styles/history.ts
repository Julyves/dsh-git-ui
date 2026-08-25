/** 历史列表与过滤树样式（history / tree / select / ref）。 */
import type { CSSProperties } from 'react'


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


/** 分支与远程同步差异徽标（↑n ↓m），弱化等宽小字。 */
export const treeSyncBadge: CSSProperties = {
  flex: 'none',
  fontSize: 10,
  lineHeight: '14px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}


/** 过滤树头部 fetch 按钮（与搜索框同栏）。 */
export const treeFetchBtn: CSSProperties = {
  flex: 'none',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '14px',
  padding: '4px 8px',
  cursor: 'pointer',
  font: 'inherit',
  whiteSpace: 'nowrap',
}


/** fetch 结果提示（成功弱化色 / 失败可见文本）。 */
export const treeFetchNote: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  padding: '4px 12px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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


/** 左右侧栏外壳（静态轻面 bg-layer-1；分隔线按侧内联）。
 * 语义：面层级色，而非交互态色（旧用 interactive-bg-hover 属语义误用）。 */
export const paneSide: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: 'var(--dsw-alias-bg-layer-1)',
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


/** 搜索条目装饰圆点槽（28px 列居中，替代分支图位置，条目不紧贴左侧）。 */
export const searchDot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}


/** 装饰圆点本体：10px 直径 + 背景描边（与分支图节点圆同一视觉语言；选中态由行内 boxShadow 环强化）。 */
export const searchDotInner: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: '1.5px solid var(--dsw-alias-bg-layer-2)',
  flex: 'none',
}


export const historyRowSelected: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-active)',
  // 左侧 3px 强调条（inset 阴影不挤占 grid 布局）：与右侧详情面板的选中锚定联动。
  boxShadow: 'inset 3px 0 0 0 var(--dsw-alias-state-business-primary)',
}


/** 表头：粘性置顶，与行共用列模板（跨行对齐的表格契约）。
 * macOS 表头规范：11px semibold 弱化色 + 半透明底（blur 透出滚动内容）。 */
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
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent)',
  WebkitBackdropFilter: 'blur(6px)',
  backdropFilter: 'blur(6px)',
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


/** IDEA 式 merge 提交主题：弱化三等色——多父提交不喧宾夺主。 */
export const commitSubjectMerge: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontWeight: 400,
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


/** 提交详情头部元信息行（hash 徽标 · 作者 · 时间）。 */
export const commitDetailMetaRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}


/** 提交详情 hash 徽标：等宽小胶囊（与 refs 胶囊/stat chips 同族）。 */
export const commitDetailHash: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  lineHeight: '15px',
  padding: '1px 6px',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-secondary)',
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

