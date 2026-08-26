/**
 * Markdown 渲染视图排版（token 化：全部经 --dsw-alias-* 走宿主亮/暗主题）。
 * 层级字号按 12px 正文基准等比收缩/放大；间距紧凑（预览面板内嵌场景）。
 */
import type { CSSProperties } from 'react'

/** 渲染容器：独立纵向滚动，正文常规字体（等宽仅用于代码）。 */
export const mdContainer: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '12px 18px 24px',
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  lineHeight: 1.65,
  color: 'var(--dsw-alias-label-primary)',
}

/** 段落。 */
export const mdParagraph: CSSProperties = {
  margin: '0 0 10px',
}

/** 标题层级字号（h1–h6；键 = level）。 */
export const mdHeadings: readonly CSSProperties[] = [
  {}, // level 0 占位（标题从 1 起）
  { margin: '18px 0 10px', fontSize: '1.7em', fontWeight: 700, lineHeight: 1.3 },
  { margin: '16px 0 8px', fontSize: '1.45em', fontWeight: 700, lineHeight: 1.3 },
  { margin: '14px 0 8px', fontSize: '1.22em', fontWeight: 600, lineHeight: 1.35 },
  { margin: '12px 0 6px', fontSize: '1.08em', fontWeight: 600, lineHeight: 1.4 },
  { margin: '10px 0 6px', fontSize: '1em', fontWeight: 600, lineHeight: 1.4 },
  { margin: '10px 0 6px', fontSize: '0.94em', fontWeight: 600, lineHeight: 1.4 },
]

/** 三档标题的具名别名（mdHeadings 索引取不到时的兜底用 h4）。 */
export const mdH4: CSSProperties = mdHeadings[4]!

/** 水平分隔线。 */
export const mdHr: CSSProperties = {
  border: 0,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  margin: '14px 0',
}

/** 粗体。 */
export const mdStrong: CSSProperties = { fontWeight: 700 }

/** 斜体。 */
export const mdEm: CSSProperties = { fontStyle: 'italic' }

/** 删除线。 */
export const mdStrike: CSSProperties = {
  textDecoration: 'line-through',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 行内代码。 */
export const mdInlineCode: CSSProperties = {
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: '0.9em',
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
}

/** 链接。 */
export const mdLink: CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
  textDecoration: 'none',
}

/** 图片：块级限宽（外链图按容器缩放）。 */
export const mdImage: CSSProperties = {
  maxWidth: '100%',
  borderRadius: 6,
  margin: '4px 0',
}

/** 引用块：左侧业务色淡条 + 弱化文字。 */
export const mdQuote: CSSProperties = {
  margin: '0 0 10px',
  padding: '4px 12px',
  borderLeft: '3px solid var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  borderRadius: '0 6px 6px 0',
  color: 'var(--dsw-alias-label-secondary)',
}

/** 列表容器。 */
export const mdList: CSSProperties = {
  margin: '0 0 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

/** 列表项行：标记槽 + 内容。 */
export const mdListItem: CSSProperties = {
  display: 'flex',
  gap: 7,
  alignItems: 'baseline',
}

/** 列表标记槽（圆点/序号，定宽对齐）。 */
export const mdListMarker: CSSProperties = {
  flex: 'none',
  minWidth: 16,
  color: 'var(--dsw-alias-label-tertiary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 列表项内容（子列表缩进挂载其下）。 */
export const mdListItemText: CSSProperties = {
  flex: 1,
  minWidth: 0,
}

/** 围栏代码块外壳。 */
export const mdPre: CSSProperties = {
  margin: '0 0 10px',
  padding: '8px 10px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  overflowX: 'auto',
}

/** 代码块内容（等宽）。 */
export const mdCode: CSSProperties = {
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: '0.92em',
  lineHeight: '18px',
}

/** 代码行（逐行容器——高亮 token 按行挂载）。 */
export const mdCodeLine: CSSProperties = {
  minHeight: 18,
  whiteSpace: 'pre',
}

/** 表格外壳（横向滚动兜底宽表）。 */
export const mdTableWrap: CSSProperties = {
  margin: '0 0 10px',
  overflowX: 'auto',
}

/** 表格。 */
export const mdTable: CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: '0.95em',
}

/** 表头行。 */
export const mdTableRowHead: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

/** 表头单元格。 */
export const mdTableHead: CSSProperties = {
  textAlign: 'left',
  fontWeight: 600,
  padding: '5px 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
}

/** 数据行。 */
export const mdTableRow: CSSProperties = {}

/** 数据单元格。 */
export const mdTableCell: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
}
