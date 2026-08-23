/**
 * 设置模块基础控件：开关 / 分段选择器 / 步进器。
 * 全部为受控组件，样式经 styles.ts 的设置区 token 解析（零硬编码色值），
 * 无障碍：native button（键盘原生可达）+ role switch / tablist 语义。
 */
import type { JSX } from 'react'
import * as css from '../styles.ts'

// ── Switch：Mac 风开关（40×24 轨道 + 20px 滑钮，business 色激活态） ─────────

export function Switch({
  checked, onChange, label, disabled = false,
}: {
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  /** 无障碍名称（与设置行名称一致）。 */
  readonly label: string
  readonly disabled?: boolean
}): JSX.Element {
  // 激活色经 inline 条件切换（settingsSwitchOn）——勿依赖全局 CSS 的
  // [data-on] 背景覆盖：inline style 优先级高于任何 class 选择器，CSS 层的
  // 激活背景被压住，导致开态轨道一直停留在 off 灰（本项目此前的隐形缺陷）。
  // data-on 仅保留给滑钮位移（inline 不含 transform，CSS 可正常接管）。
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="dsh-git-ui__switch"
      style={checked ? { ...css.settingsSwitch, ...css.settingsSwitchOn } : css.settingsSwitch}
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    >
      <span className="dsh-git-ui__switch-knob" style={css.settingsSwitchKnob} aria-hidden="true" />
    </button>
  )
}

// ── SegmentedControl：iOS 式分段控件（激活段凸起） ─────────────────────────

export function SegmentedControl<T extends string>({
  value, options, onChange, ariaLabel,
}: {
  readonly value: T
  readonly options: readonly { readonly id: T; readonly label: string }[]
  readonly onChange: (next: T) => void
  readonly ariaLabel: string
}): JSX.Element {
  return (
    <div className="dsh-git-ui__segmented" style={css.settingsSegmented} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`dsh-git-ui__segment${active ? ' dsh-git-ui__segment--active' : ''}`}
            style={active ? { ...css.settingsSegment, ...css.settingsSegmentActive } : css.settingsSegment}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Stepper：数值步进（最近提交条数 0..MAX） ──────────────────────────────

export function Stepper({
  value, min, max, onChange, ariaLabel, zeroLabel,
}: {
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onChange: (next: number) => void
  readonly ariaLabel: string
  /** value === min 时替代数字显示的文案（如「隐藏」）。 */
  readonly zeroLabel?: string
}): JSX.Element {
  return (
    <span style={css.settingsStepper} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="dsh-git-ui__icon-btn"
        style={css.settingsStepperBtn}
        aria-label={ariaLabel}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span style={css.settingsStepperValue}>{value === min ? (zeroLabel ?? String(value)) : String(value)}</span>
      <button
        type="button"
        className="dsh-git-ui__icon-btn"
        style={css.settingsStepperBtn}
        aria-label={ariaLabel}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  )
}
