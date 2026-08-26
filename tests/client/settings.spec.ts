/**
 * 设置协议与存储测试：派生规则 / 补丁规则 / schema 校验 / 存储生命周期。
 * 纯逻辑层，无 React（useSettings 的 useSyncExternalStore 行为由组件层保证）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIFF_SETTINGS, DEFAULT_POPUP_ORDER, DEFAULT_SETTINGS, MAX_RECENT_COMMITS, PRESETS, SETTINGS_SCHEMA_VERSION,
  applyPreset, clampRecents, migrateSettings, normalizePopupOrder, patchPill, patchPopup, patchPopupOrder,
  popupOrderEqual, presetOf, settingsEqual, settingsEqualAll,
  type GitUISettings, type SettingsPersistence, type SettingsStorageLike,
} from '../../src/contracts/settings.ts'
import { settingsEnvelopeSchema } from '../../src/client/settings/schema.ts'
import { createSettingsStore } from '../../src/client/settings/store.ts'

/** 内存存储桩：读写模拟 localStorage。 */
function memoryStorage(initial: string | null = null): SettingsStorageLike & { dump(): string | null } {
  let value = initial
  return {
    read: () => value,
    write: (raw) => { value = raw },
    dump: () => value,
  }
}

describe('presetOf（纯派生显示模式）', () => {
  it('derives minimal / standard / full from exact matches', () => {
    for (const preset of PRESETS) {
      expect(presetOf(preset.settings)).toBe(preset.id)
    }
  })

  it('derives custom for any hand-tweaked combination', () => {
    const tweaked = patchPill(DEFAULT_SETTINGS, { sync: false })
    expect(presetOf(tweaked)).toBe('custom')
  })

  it('falls back to the preset when a tweak returns to an exact preset value', () => {
    const tweaked = patchPill(DEFAULT_SETTINGS, { sync: false })
    const back = patchPill(tweaked, { sync: true })
    expect(presetOf(back)).toBe('standard')
  })
})

describe('applyPreset（档位应用）', () => {
  it('applies the full combination (pill + popup) of the chosen preset', () => {
    const settings = applyPreset(DEFAULT_SETTINGS, 'minimal')
    expect(settings.pill.counts.staged).toBe(false)
    expect(settings.pill.sync).toBe(false)
    // popup 保持弹窗完整性（极简只瘦身 Pill）。
    expect(settings.popup.changesList).toBe(true)
  })

  it('returns the input unchanged for custom', () => {
    expect(applyPreset(DEFAULT_SETTINGS, 'custom')).toBe(DEFAULT_SETTINGS)
  })
})

describe('patchPill / patchPopup（不可变补丁）', () => {
  it('patchPill only touches the given fields and keeps the source intact', () => {
    const before = DEFAULT_SETTINGS
    const after = patchPill(before, { dot: false, counts: { staged: false } })
    expect(after.pill.dot).toBe(false)
    expect(after.pill.counts.staged).toBe(false)
    expect(after.pill.counts.modified).toBe(true) // 未声明子项保留原值
    expect(before.pill.dot).toBe(true) // 源不可变
  })

  it('patchPopup clamps recentCommits into [0, MAX_RECENT_COMMITS]', () => {
    expect(patchPopup(DEFAULT_SETTINGS, { recentCommits: 99 }).popup.recentCommits).toBe(MAX_RECENT_COMMITS)
    expect(patchPopup(DEFAULT_SETTINGS, { recentCommits: -3 }).popup.recentCommits).toBe(0)
    expect(patchPopup(DEFAULT_SETTINGS, { recentCommits: 2.9 }).popup.recentCommits).toBe(2) // 取整
  })

  it('clampRecents rejects non-finite input with the standard default', () => {
    expect(clampRecents(Number.NaN)).toBe(3)
    expect(clampRecents(Number.POSITIVE_INFINITY)).toBe(3)
  })

  it('settingsEqual distinguishes deep differences', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBe(true)
    expect(settingsEqual(DEFAULT_SETTINGS, patchPopup(DEFAULT_SETTINGS, { changesList: false }))).toBe(false)
    expect(settingsEqual(DEFAULT_SETTINGS, patchPill(DEFAULT_SETTINGS, { counts: { untracked: false } }))).toBe(false)
  })
})

describe('settingsEnvelopeSchema（持久化校验）', () => {
  it('parses a valid envelope', () => {
    const raw = JSON.stringify({ v: 2, settings: DEFAULT_SETTINGS })
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    expect(parsed.settings.pill.dot).toBe(true)
  })

  it('accepts a v1 envelope without the diff dimension', () => {
    const v1 = { pill: DEFAULT_SETTINGS.pill, popup: DEFAULT_SETTINGS.popup }
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(JSON.stringify({ v: 1, settings: v1 })))
    expect(parsed.settings.diff).toBeUndefined()
  })

  it('strips unknown fields (forward compatibility tolerance)', () => {
    const raw = JSON.stringify({ v: 2, settings: { ...DEFAULT_SETTINGS, future: true } })
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    expect('future' in parsed.settings).toBe(false)
  })

  it('rejects malformed shapes (bad types, out-of-range commits)', () => {
    expect(settingsEnvelopeSchema.safeParse({ v: 2, settings: { ...DEFAULT_SETTINGS, pill: { ...DEFAULT_SETTINGS.pill, dot: 'yes' } } }).success).toBe(false)
    expect(settingsEnvelopeSchema.safeParse({ v: 2, settings: { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, recentCommits: 99 } } }).success).toBe(false)
    expect(settingsEnvelopeSchema.safeParse({ v: 2, settings: { ...DEFAULT_SETTINGS, diff: { ...DEFAULT_SETTINGS.diff, fontSize: 99 } } }).success).toBe(false)
  })
})

describe('migrateSettings（v1 → v2 差异维度补齐）', () => {
  it('fills the diff dimension with defaults and keeps pill/popup intact', () => {
    const v1 = { pill: patchPill(DEFAULT_SETTINGS, { sync: false }).pill, popup: patchPopup(DEFAULT_SETTINGS, { recentCommits: 0 }).popup }
    const migrated = migrateSettings(v1)
    expect(migrated.pill.sync).toBe(false)
    expect(migrated.popup.recentCommits).toBe(0)
    expect(migrated.diff).toEqual(DEFAULT_DIFF_SETTINGS)
  })

  it('keeps a partial diff dimension (forward partial writes)', () => {
    const v1 = { pill: DEFAULT_SETTINGS.pill, popup: DEFAULT_SETTINGS.popup, diff: { fontSize: 14 } }
    const migrated = migrateSettings(v1)
    expect(migrated.diff.fontSize).toBe(14)
    expect(migrated.diff.syntaxHighlight).toBe(true)
  })

  it('fills workRecord with the default when absent (v2 → v3)', () => {
    const v2 = {
      pill: { ...DEFAULT_SETTINGS.pill, workRecord: undefined } as unknown as Record<string, unknown>,
      popup: DEFAULT_SETTINGS.popup,
      diff: DEFAULT_DIFF_SETTINGS,
    }
    // v2 数据没有 workRecord 字段 → 迁移补默认 true,其余保留。
    delete (v2 as { pill: Record<string, unknown> }).pill.workRecord
    const migrated = migrateSettings(v2 as unknown as Parameters<typeof migrateSettings>[0])
    expect(migrated.pill.workRecord).toBe(true)
    expect(migrated.pill.dot).toBe(DEFAULT_SETTINGS.pill.dot)
  })

  it('respects an explicit false workRecord (user turned it off)', () => {
    const migrated = migrateSettings({
      pill: { ...DEFAULT_SETTINGS.pill, workRecord: false },
      popup: DEFAULT_SETTINGS.popup,
    })
    expect(migrated.pill.workRecord).toBe(false)
  })

  it('preset linkage: minimal hides workRecord, standard/full show it', () => {
    expect(presetOf(applyPreset(DEFAULT_SETTINGS, 'minimal'))).toBe('minimal')
    expect(applyPreset(DEFAULT_SETTINGS, 'minimal').pill.workRecord).toBe(false)
    expect(applyPreset(DEFAULT_SETTINGS, 'standard').pill.workRecord).toBe(true)
    expect(applyPreset(DEFAULT_SETTINGS, 'full').pill.workRecord).toBe(true)
  })
})

/** 内存持久化桩：模拟 host 磁盘通道（settings.json）。 */
function memoryPersistence(initial: string | null = null): SettingsPersistence & { dump(): string | null } {
  let value = initial
  let writes = 0
  return {
    read: async () => value,
    write: async (raw) => { value = raw; writes += 1 },
    dump: () => value,
  }
}

describe('createSettingsStore（存储生命周期：host 主存储 + 迁移）', () => {
  it('starts from DEFAULT_SETTINGS when no legacy payload is present', () => {
    const store = createSettingsStore(memoryStorage())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(createSettingsStore(null).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('initialize loads from the host persistence and persists updates (debounced flush)', async () => {
    const persistence = memoryPersistence(JSON.stringify({ v: 2, settings: { ...DEFAULT_SETTINGS, pill: { ...DEFAULT_SETTINGS.pill, dot: false } } }))
    const store = createSettingsStore(null)
    await store.initialize(persistence)
    expect(store.get().pill.dot).toBe(false)
    const next = patchPill(store.get(), { sync: false })
    store.setSettings(next)
    await store.flush()
    expect(persistence.dump()).toContain('"sync":false')
    // 写盘信封携带当前 schema 版本（版本常量驱动，升版不破测试）。
    expect(persistence.dump()).toContain(`"v":${SETTINGS_SCHEMA_VERSION}`)
    // 旧信封（v2，无 popupOrder）迁入后补默认排序。
    expect(store.get().popupOrder).toEqual(DEFAULT_POPUP_ORDER)
  })

  it('migrates the v1 legacy localStorage payload when host has no data (and writes it back)', async () => {
    const legacy = memoryStorage(JSON.stringify({ v: 1, settings: { pill: { ...DEFAULT_SETTINGS.pill, dot: false }, popup: DEFAULT_SETTINGS.popup } }))
    const persistence = memoryPersistence(null)
    const store = createSettingsStore(legacy)
    await store.initialize(persistence)
    expect(store.get().pill.dot).toBe(false)
    expect(store.get().diff).toEqual(DEFAULT_DIFF_SETTINGS) // v1 补齐
    expect(persistence.dump()).toContain('"diff"') // 写回 host
  })

  it('ignores host read failures (keeps the in-memory state)', async () => {
    const store = createSettingsStore(null)
    await store.initialize({
      read: async () => { throw new Error('rpc down') },
      write: async () => {},
    })
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('does not clobber user edits made while the host load is in flight', async () => {
    let resolveRead!: (value: string | null) => void
    const persistence = {
      read: () => new Promise<string | null>((resolve) => { resolveRead = resolve }),
      write: async () => {},
    }
    const store = createSettingsStore(null)
    const pending = store.initialize(persistence)
    // 加载未完成时用户已修改
    store.setSettings(patchPill(store.get(), { sync: false }))
    resolveRead(JSON.stringify({ v: 2, settings: patchPill(DEFAULT_SETTINGS, { dot: false }) }))
    await pending
    // 用户修改保留（不被磁盘旧值覆盖）
    expect(store.get().pill.sync).toBe(false)
    expect(store.get().pill.dot).toBe(true) // 磁盘值未采用
  })

  it('falls back to defaults for corrupted or version-mismatched payloads', () => {
    const corrupted = createSettingsStore(memoryStorage('{not json'))
    expect(corrupted.get()).toEqual(DEFAULT_SETTINGS)
    const wrongVersion = createSettingsStore(memoryStorage(JSON.stringify({ v: 999, settings: DEFAULT_SETTINGS })))
    expect(wrongVersion.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('notifies listeners on change and detaches on unsubscribe', () => {
    const store = createSettingsStore(memoryStorage())
    // 数组容器而非闭包变量：TS 7 对闭包赋值的窄化会把外层读取判为 never。
    const seen: GitUISettings[] = []
    const off = store.subscribe(() => { seen.push(store.get()) })
    store.setSettings(patchPill(store.get(), { sync: false }))
    expect(seen.at(-1)?.pill.sync).toBe(false)
    off()
    store.setSettings(patchPill(store.get(), { sync: true }))
    expect(seen.at(-1)?.pill.sync).toBe(false) // 不再通知
  })

  it('skips no-op updates (same reference) without notifying', () => {
    const store = createSettingsStore(memoryStorage())
    let calls = 0
    store.subscribe(() => { calls += 1 })
    const current = store.get()
    store.setSettings(current)
    expect(calls).toBe(0)
  })
})

describe('popupOrder（弹窗区块排序维度）', () => {
  it('normalizePopupOrder: 去重/剔未知/缺块按默认序补齐', () => {
    expect(normalizePopupOrder(['changesList', 'statusBar'])).toEqual(['changesList', 'statusBar', 'branchCreate', 'workRecord', 'recentCommits'])
    expect(normalizePopupOrder(['bogus', 'statusBar', 'statusBar'])).toEqual(['statusBar', 'branchCreate', 'workRecord', 'recentCommits', 'changesList'])
    expect(normalizePopupOrder([])).toEqual(DEFAULT_POPUP_ORDER)
  })

  it('patchPopupOrder: 不可变更新 + 消毒', () => {
    const next = patchPopupOrder(DEFAULT_SETTINGS, ['recentCommits', 'nope'])
    expect(next.popupOrder).toEqual(['recentCommits', 'statusBar', 'branchCreate', 'workRecord', 'changesList'])
    expect(DEFAULT_SETTINGS.popupOrder).toEqual(DEFAULT_POPUP_ORDER) // 原值不动
  })

  it('popupOrderEqual: 序即身份', () => {
    expect(popupOrderEqual(DEFAULT_POPUP_ORDER, DEFAULT_POPUP_ORDER)).toBe(true)
    expect(popupOrderEqual(['statusBar', 'changesList'], ['changesList', 'statusBar'])).toBe(false)
  })

  it('migrateSettings: v3 旧数据缺 popupOrder 补默认；带合法序保留；带垃圾消毒', () => {
    const v3 = migrateSettings({ pill: DEFAULT_SETTINGS.pill, popup: DEFAULT_SETTINGS.popup })
    expect(v3.popupOrder).toEqual(DEFAULT_POPUP_ORDER)
    const custom = migrateSettings({ pill: DEFAULT_SETTINGS.pill, popup: DEFAULT_SETTINGS.popup, popupOrder: ['changesList', 'statusBar'] })
    expect(custom.popupOrder).toEqual(['changesList', 'statusBar', 'branchCreate', 'workRecord', 'recentCommits'])
    const dirty = migrateSettings({ pill: DEFAULT_SETTINGS.pill, popup: DEFAULT_SETTINGS.popup, popupOrder: ['junk'] as unknown as string[] })
    expect(dirty.popupOrder).toEqual(DEFAULT_POPUP_ORDER)
  })

  it('独立性: 重排不打回 custom，切预设不丢排序，重置判定包含排序', () => {
    const reordered: GitUISettings = {
      ...DEFAULT_SETTINGS,
      popupOrder: ['changesList' as const, ...DEFAULT_POPUP_ORDER.filter((id) => id !== 'changesList')],
    }
    // 重排后 pill+popup 组合未变 → 档位仍是 standard（独立维度语义）。
    expect(presetOf(reordered)).toBe('standard')
    // 切到 minimal 再看：用户排序原样保留。
    const afterPreset = applyPreset(reordered, 'minimal')
    expect(afterPreset.popupOrder).toEqual(reordered.popupOrder)
    // 排序不同 → settingsEqualAll 为假（重置按钮可点）。
    expect(settingsEqualAll(reordered, DEFAULT_SETTINGS)).toBe(false)
    expect(settingsEqualAll({ ...reordered, popupOrder: DEFAULT_POPUP_ORDER }, DEFAULT_SETTINGS)).toBe(true)
  })
})
