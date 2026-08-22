/**
 * 设置 Tab：Pill / 弹窗信息组件的可配置面板。
 *
 * 结构（协议驱动，全部状态来自 SettingsStore 单例）：
 *   ① 实时预览卡（renderPill 同管道）
 *   ② 显示模式分段控件（presetOf 纯派生；选档 = applyPreset 覆盖 pill+popup）
 *   ③ Pill 显示开关矩阵（含变更计数三子项徽章）
 *   ④ 详情弹窗开关矩阵（含最近提交条数步进器）
 *   ⑤ 底部：重置为默认（toast 反馈）
 *
 * 扩展：新增设置项 = 新增一行 SettingRow + Patch 类型已由协议承载，本组件
 * 仅做声明式渲染。
 */
import type { JSX } from 'react'
import {
  DEFAULT_SETTINGS, MAX_RECENT_COMMITS, PRESETS, applyPreset, patchPill, patchPopup,
  presetOf, settingsEqual, type GitUISettings, type PillPatch, type PopupPatch, type PresetId,
} from '../../contracts/settings.ts'
import { settingsStore } from './store.ts'
import { useSettings } from './use-settings.ts'
import { SegmentedControl, Stepper, Switch } from './controls.tsx'
import { SettingsPreview } from './SettingsPreview.tsx'
import { BranchIcon, DiffIcon, FolderIcon } from '../icons.tsx'
import type { T } from '../pill-segments.tsx'
import type { GitKey } from '../locales.ts'
import * as css from '../styles.ts'

/** 设置行：图标槽 + 名称/描述 + 尾端控件。 */
function SettingsRow({
  icon, name, desc, control,
}: {
  readonly icon: JSX.Element | null
  readonly name: string
  readonly desc: string
  readonly control: JSX.Element | null
}): JSX.Element {
  return (
    <div className="dsh-git-ui__row" style={css.settingsRow}>
      {icon !== null && <span style={css.settingsRowIcon} aria-hidden="true">{icon}</span>}
      <span style={css.settingsRowBody}>
        <span style={css.settingsRowName}>{name}</span>
        <span style={css.settingsRowDesc}>{desc}</span>
      </span>
      {control !== null && <span style={css.settingsRowControl}>{control}</span>}
    </div>
  )
}

/** 显示模式档位的 i18n key（与 PRESETS 规则表解耦，纯 UI 映射）。 */
const PRESET_LABEL_KEY: Record<PresetId, GitKey> = {
  minimal: 'settings.preset.minimal',
  standard: 'settings.preset.standard',
  full: 'settings.preset.full',
  custom: 'settings.preset.custom',
}

/** 变更计数三子项徽章：点击切换，开=语义色淡晕 / 关=弱化描边。 */
function CountsBadges({
  settings, onToggle, t,
}: {
  readonly settings: GitUISettings
  readonly onToggle: (key: 'staged' | 'modified' | 'untracked') => void
  readonly t: T
}): JSX.Element {
  const items = [
    { key: 'staged' as const, glyph: '+', labelKey: 'settings.counts.staged' as GitKey },
    { key: 'modified' as const, glyph: '−', labelKey: 'settings.counts.modified' as GitKey },
    { key: 'untracked' as const, glyph: '?', labelKey: 'settings.counts.untracked' as GitKey },
  ]
  return (
    <span style={css.settingsCountsBadges} role="group" aria-label={t('settings.counts')}>
      {items.map(({ key, glyph, labelKey }) => {
        const on = settings.pill.counts[key]
        return (
          <button
            key={key}
            type="button"
            className="dsh-git-ui__counts-badge"
            style={{ ...css.settingsCountBadge, ...(on ? css.settingsCountBadgeOn : {}) }}
            aria-pressed={on}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            onClick={() => onToggle(key)}
          >
            <span style={css.settingsCountBadgeGlyph}>{glyph}</span>
            <span>{t(labelKey)}</span>
          </button>
        )
      })}
    </span>
  )
}

/** 全部 Pill 片段关闭？（用于兜底提示——状态点将强制保留。） */
function pillFullyOff(settings: GitUISettings): boolean {
  const p = settings.pill
  return !p.dot && !p.branch && !p.sync
    && !p.counts.staged && !p.counts.modified && !p.counts.untracked
}

export function SettingsTab({
  t, notify,
}: {
  readonly t: T
  /** 轻量提示（reset 完成等），由 Git 中心的 toast 通道承接。 */
  readonly notify: (text: string) => void
}): JSX.Element {
  const settings = useSettings()
  const mode = presetOf(settings)

  const applyPill = (patch: PillPatch): void => settingsStore.setSettings(patchPill(settings, patch))
  const applyPopup = (patch: PopupPatch): void => settingsStore.setSettings(patchPopup(settings, patch))

  const toggleCount = (key: 'staged' | 'modified' | 'untracked'): void => {
    applyPill({ counts: { [key]: !settings.pill.counts[key] } })
  }

  const presetOptions = [
    ...PRESETS.map((preset) => ({ id: preset.id as PresetId, label: t(PRESET_LABEL_KEY[preset.id]) })),
    { id: 'custom' as PresetId, label: t(PRESET_LABEL_KEY.custom) },
  ]

  return (
    <>
      <SettingsPreview settings={settings.pill} t={t} />

      <section style={css.settingsCard}>
        <div style={css.settingsCardHead}>
          <span style={css.settingsCardTitle}>{t('settings.preset')}</span>
          <span style={css.settingsCardNote}>{t('settings.preset.note')}</span>
        </div>
        <SegmentedControl
          value={mode}
          options={presetOptions}
          ariaLabel={t('settings.preset')}
          onChange={(id) => settingsStore.setSettings(applyPreset(settings, id))}
        />
      </section>

      <section style={css.settingsCard}>
        <div style={css.settingsCardHead}>
          <span style={css.settingsCardTitle}>{t('settings.group.pill')}</span>
        </div>
        <SettingsRow
          icon={<span style={{ ...css.dot, display: 'inline-block' }} aria-hidden="true" />}
          name={t('settings.dot')}
          desc={t('settings.dot.desc')}
          control={<Switch checked={settings.pill.dot} label={t('settings.dot')} onChange={(next) => applyPill({ dot: next })} />}
        />
        <SettingsRow
          icon={<BranchIcon />}
          name={t('settings.branch')}
          desc={t('settings.branch.desc')}
          control={<Switch checked={settings.pill.branch} label={t('settings.branch')} onChange={(next) => applyPill({ branch: next })} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">+/−</span>}
          name={t('settings.counts')}
          desc={t('settings.counts.desc')}
          control={<CountsBadges settings={settings} onToggle={toggleCount} t={t} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">⇅</span>}
          name={t('settings.sync')}
          desc={t('settings.sync.desc')}
          control={<Switch checked={settings.pill.sync} label={t('settings.sync')} onChange={(next) => applyPill({ sync: next })} />}
        />
        {pillFullyOff(settings) && (
          <div style={css.settingsRowHint}>{t('settings.allOffHint')}</div>
        )}
      </section>

      <section style={css.settingsCard}>
        <div style={css.settingsCardHead}>
          <span style={css.settingsCardTitle}>{t('settings.group.popup')}</span>
        </div>
        <SettingsRow
          icon={<FolderIcon />}
          name={t('settings.rootPath')}
          desc={t('settings.rootPath.desc')}
          control={<Switch checked={settings.popup.rootPath} label={t('settings.rootPath')} onChange={(next) => applyPopup({ rootPath: next })} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">123</span>}
          name={t('settings.statusBar')}
          desc={t('settings.statusBar.desc')}
          control={<Switch checked={settings.popup.statusBar} label={t('settings.statusBar')} onChange={(next) => applyPopup({ statusBar: next })} />}
        />
        <SettingsRow
          icon={<BranchIcon />}
          name={t('settings.branchSwitcher')}
          desc={t('settings.branchSwitcher.desc')}
          control={<Switch checked={settings.popup.branchSwitcher} label={t('settings.branchSwitcher')} onChange={(next) => applyPopup({ branchSwitcher: next })} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">+</span>}
          name={t('settings.branchCreate')}
          desc={t('settings.branchCreate.desc')}
          control={<Switch checked={settings.popup.branchCreate} label={t('settings.branchCreate')} onChange={(next) => applyPopup({ branchCreate: next })} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">≋</span>}
          name={t('settings.recentCommits')}
          desc={t('settings.recentCommits.desc')}
          control={(
            <Stepper
              value={settings.popup.recentCommits}
              min={0}
              max={MAX_RECENT_COMMITS}
              ariaLabel={t('settings.recentCommits')}
              zeroLabel={t('settings.recentCommits.none')}
              onChange={(next) => applyPopup({ recentCommits: next })}
            />
          )}
        />
        <SettingsRow
          icon={<DiffIcon />}
          name={t('settings.changesList')}
          desc={t('settings.changesList.desc')}
          control={<Switch checked={settings.popup.changesList} label={t('settings.changesList')} onChange={(next) => applyPopup({ changesList: next })} />}
        />
      </section>

      <div style={css.settingsFooter}>
        <span style={css.settingsFooterNote}>{t('settings.subtitle')}</span>
        <button
          type="button"
          className="dsh-git-ui__refresh"
          style={css.settingsResetButton}
          disabled={settingsEqual(settings, DEFAULT_SETTINGS)}
          onClick={() => {
            settingsStore.setSettings(DEFAULT_SETTINGS)
            notify(t('settings.reset.done'))
          }}
        >
          {t('settings.reset')}
        </button>
      </div>
    </>
  )
}
