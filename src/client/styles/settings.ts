/** 设置面板样式。 */
import type { CSSProperties } from 'react'
import { rowIconButton } from './shared.ts'
import { refreshButton } from './popup.ts'


// ── Settings tab（设置模块：预览卡 / 显示模式 / 开关矩阵 / 步进器）────────────

/** 预览卡：顶部高亮表面（layer-3 + 发丝边），与弹窗卡面同级。 */
export const settingsPreview: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  overflow: 'hidden',
}


export const settingsPreviewBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px 0',
}


export const settingsPreviewLabel: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 600,
  letterSpacing: '0.4px',
  color: 'var(--dsw-alias-label-secondary)',
}


export const settingsPreviewNote: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 预览舞台：径向弱化内嵌虚线框，示意「此为演示面」。 */
export const settingsPreviewStage: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '14px 16px 18px',
}


/** 预览 Pill：与真实胶囊同型，但不响应交互（cursor: default）。 */
export const settingsPreviewPill: CSSProperties = {
  cursor: 'default',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2), 0 0 0 5px color-mix(in srgb, var(--dsw-alias-border-l2) 40%, transparent)',
}


/** 设置分组卡：layer-1 底 + 发丝边（层级低于预览卡的 layer-3 面）。 */
export const settingsCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  padding: '6px 8px 10px',
}


export const settingsCardHead: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '8px 8px 6px',
}


export const settingsCardTitle: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 600,
  letterSpacing: '0.4px',
  color: 'var(--dsw-alias-label-secondary)',
}


export const settingsCardNote: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 设置行：40px 高，图标槽 + 双行文案 + 尾端控件（行交互态由全局 CSS 承接）。 */
export const settingsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 40,
  padding: '5px 8px',
  borderRadius: 8,
}


/** 行首图标槽：28px 方形 layer-2 面 + 发丝边，承载语义小图标。 */
export const settingsRowIcon: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-secondary)',
}


// ── 弹窗区块排序卡片 ───────────────────────────────────────────────────────

/** 序号槽：定宽右对齐（1–5 的当前位置一目了然，交换后即时反馈）。 */
export const settingsOrderIndex: CSSProperties = {
  flex: 'none',
  width: 14,
  textAlign: 'right',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-tertiary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 「已隐藏」标注：弱化胶囊——隐藏区块仍在序列中占位，开启后按序出现。 */
export const settingsOrderHidden: CSSProperties = {
  display: 'inline-block',
  marginTop: 2,
  padding: '0 6px',
  borderRadius: 8,
  fontSize: 10,
  lineHeight: '14px',
  color: 'var(--dsw-alias-label-tertiary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

/** 上移/下移箭头字形（icon-btn 内核）。 */
export const settingsOrderArrow: CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
  fontWeight: 600,
}


export const settingsRowBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  flex: 1,
  minWidth: 0,
}


export const settingsRowName: CSSProperties = {
  fontSize: 13,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-primary)',
}


export const settingsRowDesc: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 尾端控件槽：右对齐、不收缩。 */
export const settingsRowControl: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
}


/** 行内说明（全关兜底提示等）。 */
export const settingsRowHint: CSSProperties = {
  margin: '2px 8px 4px',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


/** 开关轨道：40×24 胶囊。
 * 蓝色 token 选型依据（宿主 design-platform.css 实测）：alias 层的
 * button-primary-fill → brand-primary → neutral-bluish-1000/50 是「主按钮
 * 黑白灰阶」，并非蓝色——此前三轮「选 token 修复」全部错在这里，开态轨道
 * 因此渲染为黑色。真正的蓝色在静态色板 --dsw-static-blue-*（#3B82F6 标准
 * 蓝，最贴近 iOS/macOS 开关蓝），static 值不随亮暗主题变化，两主题观感一致。
 * 关闭态 = 浅蓝轨道（14% 蓝 × layer-2 底）+ 同源蓝描边——明显可辨、带品牌蓝调。
 * 激活态经 inline 合并 settingsSwitchOn 饱和蓝色（勿依赖全局 CSS data-on
 * 覆盖背景——inline style 优先级更高会压住它，本项目此前的隐形缺陷）。 */
export const settingsSwitch: CSSProperties = {
  position: 'relative',
  width: 40,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 12,
  background: 'color-mix(in srgb, var(--dsw-static-blue-500) 14%, var(--dsw-alias-bg-layer-2))',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent)',
  cursor: 'pointer',
  flex: 'none',
}


/** 开关激活态：饱和标准蓝轨道（去描边，饱满）。
 * static-blue-500 = rgb(59,130,246) #3B82F6——iOS/macOS 标准开关蓝；
 * 固定色值使亮/暗主题下同样清晰饱满。 */
export const settingsSwitchOn: CSSProperties = {
  background: 'var(--dsw-static-blue-500)',
  boxShadow: 'inset 0 0 0 1px transparent',
}


/** 开关滑钮：20px 纯白圆片（iOS 标准），位移经 data-on 由全局 CSS 切换
 * （inline 不含 transform，CSS 可正常接管位移）。锁定 #fff 不随主题变化——
 * 在浅蓝（关）/饱和蓝（开）两种轨道上均清晰可辨，lv2 投影提供浮起边界。 */
export const settingsSwitchKnob: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#ffffff',
  boxShadow: 'var(--dsw-shadow-lv2)',
}


/** 分段控件容器：iOS 式轨道（layer-2 满宽胶囊，激活段内凹凸起由行内样式叠加）。 */
export const settingsSegmented: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 3,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  margin: '0 8px 4px',
}


export const settingsSegment: CSSProperties = {
  flex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 26,
  padding: '0 6px',
  border: 'none',
  borderRadius: 7,
  background: 'transparent',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}


/**
 * 激活段：标准蓝淡晕 + 同源描边（与开关/计数徽章同语言）。
 * 旧实现用 layer-3 + border-l2 描边——亮色主题下 layer-2（轨道）与
 * layer-3（激活段）同为浅灰、border-l2 更浅，选中态几乎融入轨道、不可分辨。
 * color-mix 相对 static-blue-500 派生，亮/暗主题均保持强对比。
 */
export const settingsSegmentActive: CSSProperties = {
  background: 'color-mix(in srgb, var(--dsw-static-blue-500) 16%, transparent)',
  boxShadow: 'var(--dsw-shadow-lv1), inset 0 0 0 1px color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
  fontWeight: 500,
}


/** 计数三徽章容器。 */
export const settingsCountsBadges: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
}


/** 计数徽章：20px 高胶囊，开=语义色冲淡底色（复用 chip 语言），关=弱化描边。 */
export const settingsCountBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 7px',
  border: 'none',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
  cursor: 'pointer',
  fontFamily: 'inherit',
}


/** 开态：标准蓝淡晕底色 + 同源描边（亮/暗主题均强对比）。 */
export const settingsCountBadgeOn: CSSProperties = {
  background: 'color-mix(in srgb, var(--dsw-static-blue-500) 14%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-static-blue-500) 35%, transparent)',
  color: 'var(--dsw-alias-label-primary)',
}


export const settingsCountBadgeGlyph: CSSProperties = {
  flex: 'none',
  fontWeight: 600,
}


/** 行内小字号图形/文本槽（+/−、⇅、123 等占位图标）。 */
export const settingsCountGlyph: CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
}


/** 步进器：− 值 +（按钮复用 icon-btn 尺寸协议）。 */
export const settingsStepper: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
}


export const settingsStepperBtn: CSSProperties = {
  ...rowIconButton,
  width: 26,
  height: 26,
  fontSize: 14,
  lineHeight: '1',
}


export const settingsStepperValue: CSSProperties = {
  minWidth: 44,
  textAlign: 'center',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-primary)',
}


/** 底部行：全局生效说明 + 重置按钮。 */
export const settingsFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '2px 4px',
}


export const settingsFooterNote: CSSProperties = {
  flex: 1,
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
}


export const settingsResetButton: CSSProperties = {
  ...refreshButton,
  padding: '4px 10px',
}

