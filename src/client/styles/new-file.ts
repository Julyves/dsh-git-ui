/** 新增文件视图样式。 */
import type { CSSProperties } from 'react'


// ── 新增文件视图（纯新增：单栏全宽，无对照） ───────────────────────────────

/** 新增文件容器：单栏、统一横向滚动；字号由设置注入（style 层面合入）。 */
export const newFileContainer: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'auto',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  lineHeight: '18px',
}


/** 内容包装：width:max-content 使长行撑宽触发横向滚动（短行背景填满）。 */
export const newFileColInner: CSSProperties = {
  minWidth: '100%',
  width: 'max-content',
}


/** 文件内容行：行号槽 + 代码段（整行铺满，无行间分隔）。
 * minHeight 与容器 lineHeight 恒等（18px）：空行内容为空时高度不得塌缩——
 * 每行恒 18px 是窗口化顶垫/底垫按行高定位的前提（与 sbsCell 同族约束）。 */
export const newFileCell: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  gap: 6,
  padding: '0 8px',
  whiteSpace: 'pre',
  width: '100%',
  minHeight: 18,
}


/** 行号槽：与 sbsNum 同族（定宽右对齐 + 右侧发丝线）。 */
export const newFileNum: CSSProperties = {
  flex: 'none',
  width: 36,
  textAlign: 'right',
  paddingRight: 8,
  marginRight: 2,
  color: 'var(--dsw-alias-label-tertiary)',
  userSelect: 'none',
  borderRight: '1px solid var(--dsw-alias-border-l2)',
}


/** 代码文本段：pre 不换行，高亮 span 在其内渲染。 */
export const newFileCode: CSSProperties = {
  whiteSpace: 'pre',
  flex: 'none',
}

