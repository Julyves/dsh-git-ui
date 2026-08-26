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
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  MAX_DIFF_FONT_SIZE, MAX_RECENT_COMMITS, MIN_DIFF_FONT_SIZE, PRESETS,
  applyPreset, normalizePopupOrder, patchDiff, patchPill, patchPopup, patchPopupOrder, presetOf, settingsEqualAll,
  type DiffPatch, type GitUISettings, type PillPatch, type PopupBlockId, type PopupPatch, type PresetId,
} from '../../contracts/settings.ts'
import { settingsStore } from './store.ts'
import { useSettings } from './use-settings.ts'
import { SegmentedControl, Stepper, Switch } from './controls.tsx'
import { SettingsPreview } from './SettingsPreview.tsx'
import { BranchIcon, DiffIcon, FolderIcon, RecordIcon } from '../icons.tsx'
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
  return !p.dot && !p.branch && !p.sync && !p.workRecord
    && !p.counts.staged && !p.counts.modified && !p.counts.untracked
}

/**
 * 弹窗可排序区块元数据：图标 / 名称 / 显隐判定（workRecord 由 pill 开关
 * 治理——排序与显隐正交，隐藏区块在排序序列中标注「已隐藏」）。
 * 与 GitPopupBody 的 blockNodes 键集一致（PopupBlockId 契约承载）。
 */
const POPUP_BLOCK_META: Record<PopupBlockId, { readonly labelKey: GitKey; readonly icon: JSX.Element | null; readonly visible: (s: GitUISettings) => boolean }> = {
  statusBar: {
    labelKey: 'settings.statusBar',
    icon: <span style={css.settingsCountGlyph} aria-hidden="true">123</span>,
    visible: (s) => s.popup.statusBar,
  },
  branchCreate: {
    labelKey: 'settings.branchCreate',
    icon: <span style={css.settingsCountGlyph} aria-hidden="true">+</span>,
    visible: (s) => s.popup.branchCreate,
  },
  workRecord: {
    labelKey: 'settings.workRecord',
    icon: <RecordIcon />,
    visible: (s) => s.pill.workRecord,
  },
  recentCommits: {
    labelKey: 'settings.recentCommits',
    icon: <span style={css.settingsCountGlyph} aria-hidden="true">≋</span>,
    visible: (s) => s.popup.recentCommits > 0,
  },
  changesList: {
    labelKey: 'settings.changesList',
    icon: <DiffIcon />,
    visible: (s) => s.popup.changesList,
  },
}

export function SettingsTab({
  t, notify,
}: {
  readonly t: T
  /** 轻量提示（reset 完成等），由 Git 中心的 toast 通道承接。 */
  readonly notify: (text: string) => void
}): JSX.Element {
  const settings = useSettings()
  // 「自定义」可手动选中：override 记录用户显式选择的档位；默认跟随 presetOf
  // 纯派生。设置值一旦变化（点预设、或手动改任一开关）即清除 override 回到
  // 派生——因此「手调自动转自定义 / 改回预设自动回位」的跳转逻辑保持不变。
  const derived = presetOf(settings)
  const [override, setOverride] = useState<PresetId | null>(null)
  const mode = override ?? derived

  useEffect(() => {
    // 设置值变化（含切换预设本身）：清除显式覆盖，回到派生。
    setOverride(null)
  }, [settings])

  const applyPill = (patch: PillPatch): void => settingsStore.setSettings(patchPill(settings, patch))
  const applyPopup = (patch: PopupPatch): void => settingsStore.setSettings(patchPopup(settings, patch))
  const applyDiff = (patch: DiffPatch): void => settingsStore.setSettings(patchDiff(settings, patch))

  /** 弹窗区块排序（消毒后序列；存储侧已归一，此处防御任意来源）。 */
  const popupOrder = normalizePopupOrder(settings.popupOrder)

  /** 上移/下移一位（越界禁用由按钮 disabled 保证；patch 内再消毒）。 */
  const movePopupBlock = (from: number, delta: -1 | 1): void => {
    const to = from + delta
    if (to < 0 || to >= popupOrder.length) return
    const next = [...popupOrder]
    const [item] = next.splice(from, 1)
    if (item === undefined) return
    next.splice(to, 0, item)
    settingsStore.setSettings(patchPopupOrder(settings, next))
  }

  const toggleCount = (key: 'staged' | 'modified' | 'untracked'): void => {
    applyPill({ counts: { [key]: !settings.pill.counts[key] } })
  }

  const presetOptions = [
    ...PRESETS.map((preset) => ({ id: preset.id as PresetId, label: t(PRESET_LABEL_KEY[preset.id]) })),
    { id: 'custom' as PresetId, label: t(PRESET_LABEL_KEY.custom) },
  ]

  /** 分段切换：点击预设 = 应用完整组合并选中；点击「自定义」= 仅进入自定义（不改当前值）。 */
  const onPresetChange = (id: PresetId): void => {
    if (id === 'custom') {
      setOverride('custom')
      return
    }
    settingsStore.setSettings(applyPreset(settings, id))
    setOverride(id)
  }

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
          onChange={onPresetChange}
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
        <SettingsRow
          icon={<RecordIcon />}
          name={t('settings.workRecord')}
          desc={t('settings.workRecord.desc')}
          control={<Switch checked={settings.pill.workRecord} label={t('settings.workRecord')} onChange={(next) => applyPill({ workRecord: next })} />}
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

      <section style={css.settingsCard}>
        <div style={css.settingsCardHead}>
          <span style={css.settingsCardTitle}>{t('settings.group.popupOrder')}</span>
          <span style={css.settingsCardNote}>{t('settings.popupOrder.note')}</span>
        </div>
        {popupOrder.map((id, index) => {
          // 键域与 popupOrder 同源（PopupBlockId 契约），索引必命中。
          const meta = POPUP_BLOCK_META[id]!
          const visible = meta.visible(settings)
          return (
            <div key={id} className="dsh-git-ui__row" style={css.settingsRow}>
              <span style={css.settingsOrderIndex} aria-hidden="true">{index + 1}</span>
              {meta.icon !== null && <span style={css.settingsRowIcon} aria-hidden="true">{meta.icon}</span>}
              <span style={css.settingsRowBody}>
                <span style={css.settingsRowName}>{t(meta.labelKey)}</span>
                {!visible && <span style={css.settingsOrderHidden}>{t('settings.popupOrder.hidden')}</span>}
              </span>
              <span style={css.settingsRowControl}>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('settings.popupOrder.up')}
                  aria-label={`${t(meta.labelKey)} — ${t('settings.popupOrder.up')}`}
                  disabled={index === 0}
                  onClick={() => movePopupBlock(index, -1)}
                >
                  <span style={css.settingsOrderArrow} aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('settings.popupOrder.down')}
                  aria-label={`${t(meta.labelKey)} — ${t('settings.popupOrder.down')}`}
                  disabled={index === popupOrder.length - 1}
                  onClick={() => movePopupBlock(index, 1)}
                >
                  <span style={css.settingsOrderArrow} aria-hidden="true">↓</span>
                </button>
              </span>
            </div>
          )
        })}
      </section>

      <section style={css.settingsCard}>
        <div style={css.settingsCardHead}>
          <span style={css.settingsCardTitle}>{t('settings.group.diff')}</span>
          <span style={css.settingsCardNote}>{t('settings.group.diff.note')}</span>
        </div>
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">Aa</span>}
          name={t('settings.diff.fontSize')}
          desc={t('settings.diff.fontSize.desc')}
          control={(
            <Stepper
              value={settings.diff.fontSize}
              min={MIN_DIFF_FONT_SIZE}
              max={MAX_DIFF_FONT_SIZE}
              ariaLabel={t('settings.diff.fontSize')}
              onChange={(next) => applyDiff({ fontSize: next })}
            />
          )}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">{'</>'}</span>}
          name={t('settings.diff.syntaxHighlight')}
          desc={t('settings.diff.syntaxHighlight.desc')}
          control={<Switch checked={settings.diff.syntaxHighlight} label={t('settings.diff.syntaxHighlight')} onChange={(next) => applyDiff({ syntaxHighlight: next })} />}
        />
        <SettingsRow
          icon={<span style={css.settingsCountGlyph} aria-hidden="true">⇕</span>}
          name={t('settings.diff.foldContext')}
          desc={t('settings.diff.foldContext.desc')}
          control={<Switch checked={settings.diff.foldContext} label={t('settings.diff.foldContext')} onChange={(next) => applyDiff({ foldContext: next })} />}
        />
      </section>

      <div style={css.settingsFooter}>
        <span style={css.settingsFooterNote}>{t('settings.subtitle')}</span>
        <button
          type="button"
          className="dsh-git-ui__refresh"
          style={css.settingsResetButton}
          disabled={settingsEqualAll(settings, settingsStore.getPreset())}
          onClick={() => {
            settingsStore.resetToPreset()
            notify(t('settings.reset.done'))
          }}
        >
          {t('settings.reset')}
        </button>
      </div>
    </>
  )
}
