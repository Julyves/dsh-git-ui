/**
 * 设置协议与存储测试：派生规则 / 补丁规则 / schema 校验 / 存储生命周期。
 * 纯逻辑层，无 React（useSettings 的 useSyncExternalStore 行为由组件层保证）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, MAX_RECENT_COMMITS, PRESETS, applyPreset, clampRecents, patchPill,
  patchPopup, presetOf, settingsEqual, type GitUISettings, type SettingsStorageLike,
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
    const raw = JSON.stringify({ v: 1, settings: DEFAULT_SETTINGS })
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    expect(parsed.settings.pill.dot).toBe(true)
  })

  it('strips unknown fields (forward compatibility tolerance)', () => {
    const raw = JSON.stringify({ v: 1, settings: { ...DEFAULT_SETTINGS, future: true } })
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    expect('future' in parsed.settings).toBe(false)
  })

  it('rejects malformed shapes (bad types, out-of-range commits)', () => {
    expect(settingsEnvelopeSchema.safeParse({ v: 1, settings: { ...DEFAULT_SETTINGS, pill: { ...DEFAULT_SETTINGS.pill, dot: 'yes' } } }).success).toBe(false)
    expect(settingsEnvelopeSchema.safeParse({ v: 1, settings: { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, recentCommits: 99 } } }).success).toBe(false)
    expect(settingsEnvelopeSchema.safeParse({ v: 1, settings: { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, recentCommits: -1 } } }).success).toBe(false)
  })
})

describe('createSettingsStore（存储生命周期）', () => {
  it('starts from DEFAULT_SETTINGS when storage is empty', () => {
    const store = createSettingsStore(memoryStorage())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('loads persisted settings and persists updates', () => {
    const storage = memoryStorage()
    const store = createSettingsStore(storage)
    const next = patchPill(store.get(), { dot: false })
    store.setSettings(next)
    expect(store.get()).toEqual(next)
    expect(storage.dump()).toContain('"dot":false')
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
