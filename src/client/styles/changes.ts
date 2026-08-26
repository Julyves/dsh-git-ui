/** 变更与并排差异视图样式（changes / sbs / diff）。 */
import type { CSSProperties } from 'react'


// ── Changes 双栏布局（IDEA 式：左列表 + 右对照）─────────────────────

export const changesLayout: CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 1,
  minHeight: 0,
}


/** 左列表面板：layer-1 轻面 + 圆角 12 + 发丝边（与右侧 diff 盒子成「板—盒」对称体系）。 */
export const changesLeft: CSSProperties = {
  flex: 'none',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  background: 'var(--dsw-alias-bg-layer-1)',
  borderRadius: 12,
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  padding: '8px 6px 0',
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


/**
 * 列内容包装：width:max-content 使长行撑宽触发本列横向滚动；
 * min-width:100% 使短行背景填满列宽。两列独立，互不重叠。
 */
export const sbsColInner: CSSProperties = {
  minWidth: '100%',
  width: 'max-content',
}


/** 差异行单元格：填满列内宽（width:100%），背景覆盖整行——根治滑动后同行后半段无配色。
 * minHeight 与容器 lineHeight 恒等（18px）：空位行（empty）内容为空时 flex
 * 高度不得塌缩——每行恒 18px 是左右列纵向对齐与折叠条坐标定位的前提。 */
export const sbsCell: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  gap: 6,
  padding: '0 8px',
  whiteSpace: 'pre',
  width: '100%',
  minHeight: 18,
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


/**
 * 折叠标记覆盖层：absolute 横跨双列（top 由组件按行高计算），
 * 保持「双列独立横向滚动」的结构不被折叠条打断。
 */
export const diffFoldOverlay: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: 18,
  padding: 0,
  border: 'none',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '18px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'center',
  zIndex: 2,
}


/** 「新增」徽标（纯新增文件）：成功语义色，与基线徽标同族。 */
export const diffNewBadge: CSSProperties = {
  color: 'var(--dsw-alias-state-success-primary)',
  borderColor: 'var(--dsw-alias-state-success-primary)',
}


/** 「已删除」徽标（纯删除文件）：错误语义色，与新增徽标对称。 */
export const diffDelBadge: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  borderColor: 'var(--dsw-alias-state-error-primary)',
}

