/**
 * records v2（时段时间轴）独立样式模块。
 *
 * 与主 styles.ts 的关系：复用其语义 token 常量（chipStyles / changeNamePopBtn /
 * changeDirPop / workStateBadgeStyle / workBadge*），本模块只定义时段视图的
 * 布局级样式——「彻底抛弃旧组件形式」后，旧 records 样式块不再被引用。
 * 全部沿用 --dsw-alias-* 语义变量（主题自适应）。
 */
import type { CSSProperties } from 'react'
import { changeDirPop, changeNamePopBtn, workStateBadgeStyle } from '../styles.ts'

// ── 工具栏（摘要 + 过滤） ─────────────────────────────────────────────────

/** 工具栏容器：摘要左、过滤右（一行，废弃旧四格概览卡 + 图例条）。 */
export const recordsToolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '8px 12px',
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

/** 摘要文本（弱化但可读，一眼给全局数字）。 */
export const recordsSummaryText: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 过滤 segmented 容器。 */
export const recordsFilterGroup: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flex: 'none',
  padding: 2,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

/** 过滤项基座。 */
export const recordsFilterItem: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '2px 10px',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 11,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

/** 过滤项激活态：实底 + 主字（segmented 选中）。 */
export const recordsFilterItemActive: CSSProperties = {
  ...recordsFilterItem,
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1))',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

// ── 时段卡片流 ────────────────────────────────────────────────────────────

/** 时段流容器：卡片间由节点竖线视觉连接。 */
export const sessionList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

/** 时段卡片：横向 flex = 左缘时间轴槽 + 内容。 */
export const sessionCard: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  minWidth: 0,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  overflow: 'hidden',
}

/** 左缘时间轴槽：节点 + 贯穿竖线（内嵌卡片，废弃旧独立 32px 轴）。 */
export const sessionRail: CSSProperties = {
  flex: 'none',
  width: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

/** 时段节点（有工作）：语义蓝实心 + 光晕（时间线锚点）。 */
export const sessionDot: CSSProperties = {
  flex: 'none',
  width: 9,
  height: 9,
  borderRadius: 999,
  marginTop: 15,
  background: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary))',
  boxShadow: '0 0 0 2px color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, transparent), 0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 24%, transparent)',
}

/** 节点竖线：自节点下沿贯穿内容区（连接下一时段）。 */
export const sessionLine: CSSProperties = {
  flex: 1,
  width: 2,
  marginTop: 4,
  borderRadius: 1,
  background: 'color-mix(in srgb, var(--dsw-alias-border-l2) 90%, transparent)',
}

// ── 时段头部 ──────────────────────────────────────────────────────────────

/** 头部按钮：整行可点击（展开/收起）。 */
export const sessionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '8px 12px 8px 4px',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 0,
}

/** 头部 hover/焦点：轻量提亮（可点击 affordance）。 */
export const sessionHeadHover: CSSProperties = {
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1)) 50%, transparent)',
}

/** 时间窗主标题：时段叙事的视觉重心（大、醒目）。 */
export const sessionTitle: CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** 任务叙事(用户指令摘要):主标题位,优先于时间窗——「做了什么」先于「何时」。 */
export const sessionNarrative: CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: 260,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** 叙事在场时的时间窗:降为次级(弱色常规体,让位主标题)。 */
export const sessionTitleMuted: CSSProperties = {
  ...sessionTitle,
  fontWeight: 400,
  color: 'var(--dsw-alias-label-secondary)',
}

/** 聚合轮次弱化段（如「3 轮」）。 */
export const sessionTurnCount: CSSProperties = {
  flex: 'none',
  fontSize: 10,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
}

/** 头部徽章组（变更计数 / 外部计数），右对齐。 */
export const sessionBadges: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 'auto',
  flex: 'none',
  whiteSpace: 'nowrap',
}

// ── 展开区 ────────────────────────────────────────────────────────────────

/** 展开区容器：与头部同宽，右缘对齐。 */
export const sessionBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '2px 12px 10px 4px',
  minWidth: 0,
}

/** 分区标题（本会话 / 外部）：色点 + 文字。 */
export const sessionGroupTitle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '6px 0 2px',
  padding: '0 6px',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 分区色点（本会话=蓝 / 外部=灰，与 pill 徽章同语义）。 */
export const sessionGroupDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  flex: 'none',
}

export const sessionGroupDotInternal: CSSProperties = {
  ...sessionGroupDot,
  background: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary))',
}

/** 兄弟会话(AI)组点:品牌蓝的相邻色阶——同为 AI 工作但非本会话,与本会话可辨。 */
export const sessionGroupDotSibling: CSSProperties = {
  ...sessionGroupDot,
  background: 'var(--dsw-alias-brand-purple-strong, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-secondary)))',
}

export const sessionGroupDotExternal: CSSProperties = {
  ...sessionGroupDot,
  background: 'var(--dsw-alias-label-tertiary)',
}

// ── 时段操作条（批量暂存） ─────────────────────────────────────────────────

/** 展开区底部操作条：右对齐、与分组列表留出间距。 */
export const sessionActions: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

/** 主操作（暂存 AI 变更）：品牌蓝描边按钮。 */
export const sessionActionButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: 'none',
  padding: '3px 10px',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 11,
  lineHeight: '18px',
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 12%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 35%, transparent)',
}

/** 次操作（暂存全部）：中性弱化按钮。 */
export const sessionActionButtonSecondary: CSSProperties = {
  ...sessionActionButton,
  fontWeight: 400,
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

// ── 条目行（4 元素：chip + 文件名 + 目录 + 状态徽章） ─────────────────────

/** 条目行基座：复用 workRow 的 hover 语义，间距收紧。 */
export const entryRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '3px 8px',
  borderRadius: 6,
}

/** 文件名段（可点击时复用 changeNamePopBtn 的按钮形态）。 */
export const entryName: CSSProperties = changeNamePopBtn

/** 目录段（弱化、省略优先）。 */
export const entryDir: CSSProperties = changeDirPop

/** 状态徽章：右对齐（废弃旧「相对时刻」列——时刻收进 tooltip）。 */
export const entryState: CSSProperties = {
  flexShrink: 0,
  marginLeft: 'auto',
}

/** 条目悬停提示：把相对时刻以弱化文字并入（信息不丢）。 */
export function entryStateStyle(state: string): CSSProperties {
  return workStateBadgeStyle(state)
}

/** 推断归因的状态徽章:虚线描边——「这条记录是推断的」一眼可辨,
 * 与实心权威徽章形成视觉差(信任功能的显式不完美)。 */
export function entryStateStyleInferred(state: string): CSSProperties {
  const base = workStateBadgeStyle(state)
  return { ...base, boxShadow: undefined, border: '1px dashed var(--dsw-alias-border-l2)' }
}

/** 条目行操作槽(hover 显隐由全局 __row-actions 规则接管)。 */
export const entryActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flex: 'none',
  width: 20,
}

/** 纠错按钮(⇄):弱化文字按钮,hover 行内显现。 */
export const entryReclassifyButton: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '0 3px',
  borderRadius: 6,
  fontFamily: 'var(--ds-font-family-mono, monospace)',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
}

/** 「新」徽标(L4 指纹派生:不在上一轮边界指纹中):信息蓝小胶囊。 */
export const entryFreshChip: CSSProperties = {
  flex: 'none',
  padding: '0 5px',
  borderRadius: 6,
  fontSize: 10,
  lineHeight: '16px',
  fontWeight: 600,
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 12%, transparent)',
}

// ── 空态 / 加载态 ─────────────────────────────────────────────────────────

/** 空态容器：垂直居中，图标 + 主文案。 */
export const recordsEmpty: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '48px 20px',
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 45%, transparent)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

/** 空态图标：弱化描边（不抢文案）。 */
export const recordsEmptyIcon: CSSProperties = {
  display: 'inline-flex',
  opacity: 0.55,
}

/** 空态主文案：居中、次级色。 */
export const recordsEmptyText: CSSProperties = {
  maxWidth: 320,
  textAlign: 'center',
  fontSize: 12,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
}
