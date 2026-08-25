/** Turn 工作记录徽章与状态样式。 */
import type { CSSProperties } from 'react'


/** 工作记录徽章组(本会话/外部计数;胶囊内紧凑段)。
 * 语义文字化:「本 N」/「外 N」——纯数字无记忆点,用户无法扫读;
 * 语义色自足(蓝=本会话 agent 工作,灰=外部环境),与主干 +N −N 计数拉开。 */
export const workBadges: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: 11,
  lineHeight: '16px',
}


/** 工作记录徽章(本会话):品牌蓝淡晕底 + 蓝边 + 蓝字,一眼即「agent 工作」。 */
export const workBadgeInternal: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 35%, transparent)',
}


/** 工作记录徽章(外部):中性灰底 + 灰字,弱于本会话但可辨。 */
export const workBadgeExternal: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}


/** 工作记录徽章(其他会话 AI):品牌紫淡晕底——同为 AI 工作但非本会话,
 * 与本会话(蓝)/外部(灰)在色相上三分可辨。 */
export const workBadgeSibling: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  color: 'var(--dsw-alias-brand-purple-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-purple-strong, var(--dsw-alias-brand-blue-strong)) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-purple-strong, var(--dsw-alias-brand-blue-strong)) 35%, transparent)',
}


/** 工作记录徽章小圆点(本会话=蓝 / 外部=灰)。 */
export const workBadgeDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  display: 'inline-block',
  flex: 'none',
}


/** 未读徽章(增量信号):警示琥珀淡晕底——「要不要关心」优先于总量计数;
 * 查看后(弹窗/记录页)清零回到常规三分徽章。 */
export const workBadgeUnread: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  color: 'var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)',
}


export const workBadgeDotInternal: CSSProperties = {
  ...workBadgeDot,
  background: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary))',
}


export const workBadgeDotSibling: CSSProperties = {
  ...workBadgeDot,
  background: 'var(--dsw-alias-brand-purple-strong, var(--dsw-alias-brand-blue-strong))',
}


export const workBadgeDotExternal: CSSProperties = {
  ...workBadgeDot,
  background: 'var(--dsw-alias-label-tertiary)',
}


/** 工作记录弹窗/中心条目行(路径 + 状态徽章;hover 由全局 .dsh-git-ui__row 提供)。 */
export const workRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '2px 6px',
  margin: '0 -6px',
  borderRadius: 6,
}


/** 工作记录条目状态徽章基座(仍变更/已提交/已还原/已离开)。 */
export const workStateBadge: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  lineHeight: '14px',
  padding: '0 5px',
  borderRadius: 5,
  fontWeight: 600,
}


/** 状态四色(业务语义):dirty=品牌蓝(活跃变更)/ committed=成功绿(已入库)/
 * reverted=警告琥珀(已还原)/ gone=中性灰(已离开工作区,弱化)。 */
export const workStateDirty: CSSProperties = {
  ...workStateBadge,
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 30%, transparent)',
}


export const workStateCommitted: CSSProperties = {
  ...workStateBadge,
  color: 'var(--dsw-alias-state-success-primary)',
  background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent)',
}


export const workStateReverted: CSSProperties = {
  ...workStateBadge,
  color: 'var(--dsw-alias-state-warn-primary)',
  background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent)',
}


export const workStateGone: CSSProperties = {
  ...workStateBadge,
  color: 'var(--dsw-alias-label-tertiary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}


/** 工作记录条目写入时刻(相对时间弱化段,靠右)。 */
export const workEntryTime: CSSProperties = {
  flex: 'none',
  marginLeft: 'auto',
  fontSize: 10,
  lineHeight: '14px',
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
}


/** 工作记录条目状态徽章选择(按四态取色)。 */
export function workStateBadgeStyle(state: string): CSSProperties {
  switch (state) {
    case 'dirty': return workStateDirty
    case 'committed': return workStateCommitted
    case 'reverted': return workStateReverted
    default: return workStateGone
  }
}


/** 弹窗工作记录区块头:图标(记录)+ 标题 + 时间窗副行,自成一区。 */
export const workSectionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '14px 0 6px',
  paddingTop: 10,
  borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 55%, transparent)',
}


/** 区块头图标槽:24px 圆角面 + 品牌蓝徽记,建立「工作记录」视觉锚点。 */
export const workSectionIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 7,
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  background: 'color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 14%, transparent)',
}


/** 区块头文字列:标题 + 时间窗副行。 */
export const workSectionText: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
}


export const workSectionTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-primary)',
}


export const workSectionSub: CSSProperties = {
  fontSize: 11,
  lineHeight: '15px',
  color: 'var(--dsw-alias-label-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}


/** 工作记录分组标题(中心 Tab:本会话/外部)。 */
export const workGroupTitle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
  margin: '8px 8px 4px',
}


/** 工作记录空态(图标放大弱化 + 文案)。 */
export const workEmptyState: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '18px 12px 20px',
  color: 'var(--dsw-alias-label-tertiary)',
}


export const workEmptyIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  opacity: 0.7,
}


export const workEmptyText: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 工作记录「全部 turn 记录」入口:弹窗 footer 链接风格,非错误提示 action。 */
export const workAllLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  margin: '6px 0 2px',
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-brand-blue-strong, var(--dsw-alias-label-primary))',
  cursor: 'pointer',
}

