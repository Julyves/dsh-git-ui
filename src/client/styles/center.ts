/** Git 中心面板样式（center / tab / 工具栏 / 提交框）。 */
import type { CSSProperties } from 'react'


// ── Git center (management panel) styles ──────────────────────────────────

export const centerShell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}


/** 顶栏（功能域）：左 tab 组 + 右工具组的统一容器——替代旧标题行，
 * 为内容区让出 ~50px 高度。tab 下划线贴容器底缘（alignItems flex-end）。 */
export const topBar: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  minHeight: 44,
  padding: '0 20px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  flex: 'none',
}


/** 顶栏右端工具组：分支上下文胶囊 + 关闭（垂直居中于 44px 顶栏）。 */
export const tabsTrailing: CSSProperties = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  alignSelf: 'center',
}


/** 分支上下文胶囊（承接被移除标题行的分支信息）：pill 同族的弱化胶囊。 */
export const branchContextChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 220,
  height: 24,
  padding: '0 9px',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  cursor: 'default',
}


/** 分支上下文胶囊文本段（可省略；minWidth:0 让 flex 子项可收缩，否则 maxWidth 形同虚设）。 */
export const branchContextName: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
 * 半透明底 + backdrop blur：吸顶时滚动内容从底下透出，不糊不浮（macOS 工具栏语汇）。 */
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
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent)',
  WebkitBackdropFilter: 'blur(6px)',
  backdropFilter: 'blur(6px)',
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
  gap: 6,
  flexWrap: 'wrap',
  // 水平基准与列表行一致（面板 6px + 行内 8px = 14px），按钮与复选列对齐。
  padding: '2px 8px 6px',
}


/** 工具栏自绘按钮：发丝边胶囊族（与 treeFetchBtn/设置 reset 同语言，取代宿主 Button）。 */
export const toolButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 26,
  padding: '0 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flex: 'none',
}


/** 破坏性 armed 态：error 描边 + 淡晕（警示强调，替代纯文字变化）。 */
export const toolButtonDanger: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  borderColor: 'var(--dsw-alias-state-error-primary)',
  background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)',
}


export const commitBox: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  padding: '10px 14px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 'none',
  marginTop: 'auto',
}


export const commitInput: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 64,
  resize: 'none',
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


/** 提交区快捷键提示（等宽弱化）。 */
export const commitKbd: CSSProperties = {
  flex: 'none',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}


// ── Git center tabs (system tab spec: 13/16/500, 2px indicator) ───────────

/** Tab 组（role=tablist 容器）：间距与外框由 topBar 提供，自身仅排布。 */
export const tabs: CSSProperties = {
  display: 'flex',
  gap: 24,
  minWidth: 0,
}


export const tab: CSSProperties = {
  position: 'relative',
  // 撑满顶栏（14 上 + 16 行高 + 14 下 = 44 = topBar 高）：文字精确垂直居中
  // （14+8=22=44/2），下划线贴容器底缘（与 topBar alignItems flex-end 配合）。
  // 基础色/底色由全局 CSS 提供（.dsh-git-ui__tab），避免内联压掉 :hover/:active。
  padding: '14px 0 14px',
  border: 'none',
  fontSize: 13,
  lineHeight: '16px',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}


/** Active-tab underline rides a pseudo-element (see global CSS). */
export const tabActive: CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
}


/** Tab 内图标槽（齿轮等）：与文字基线对齐，不增加行高。 */
export const tabIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  marginRight: 5,
  verticalAlign: '-2px',
  color: 'inherit',
}


/** 功能 Tab 与偏好 Tab（设置）之间的发丝竖分隔线。 */
export const tabDivider: CSSProperties = {
  alignSelf: 'stretch',
  width: 1,
  margin: '2px 0',
  background: 'var(--dsw-alias-border-l2)',
  flex: 'none',
}


// ── Branches 管理（popup）─────────────────────────────────────────────

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


export const branchMark: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-state-business-primary)',
  fontSize: 12,
}

