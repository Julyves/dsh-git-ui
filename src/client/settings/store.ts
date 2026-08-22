/**
 * 设置存储实现：契约 `SettingsStoreLike` 的浏览器默认实现。
 *
 * - 持久化：localStorage（经 `SettingsStorageLike` 通道注入，测试用内存桩）；
 * - 校验：zod schema + 版本信封，损坏 / 旧版一律回退 DEFAULT_SETTINGS；
 * - 通知：模块级单例 + useSyncExternalStore 形状（与 GitController 同构）；
 * - 降级：localStorage 不可用（隐私模式 / 沙箱）时静默降级为内存存储。
 */
import {
  DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, SETTINGS_SCHEMA_VERSION,
  type GitUISettings, type SettingsStorageLike, type SettingsStoreLike,
} from '../../contracts/settings.ts'
import { settingsEnvelopeSchema } from './schema.ts'

/** 底层介质适配：localStorage 的 try/catch 封装（隐私模式下 getItem 可能抛错）。 */
class LocalStorageAdapter implements SettingsStorageLike {
  read(): string | null {
    try {
      return globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  }

  write(raw: string): void {
    try {
      globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, raw)
    } catch {
      // 写入失败（配额 / 隐私模式）：静默降级为内存态，不影响本会话体验。
    }
  }
}

/** 从持久化原始文本解析设置；任何异常 / 版本不匹配 → 默认。 */
function parseSettings(raw: string | null): GitUISettings {
  if (raw === null) return DEFAULT_SETTINGS
  try {
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    return parsed.v === SETTINGS_SCHEMA_VERSION ? parsed.settings : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

class SettingsStore implements SettingsStoreLike {
  private state: GitUISettings
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: SettingsStorageLike) {
    this.state = parseSettings(storage.read())
  }

  get(): GitUISettings {
    return this.state
  }

  setSettings(next: GitUISettings): void {
    if (next === this.state) return
    this.state = next
    this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private persist(): void {
    this.storage.write(JSON.stringify({ v: SETTINGS_SCHEMA_VERSION, settings: this.state }))
  }
}

/**
 * 模块级单例（浏览器内存）：GitPill / GitCenter / SettingsTab 共享同一实例，
 * 任何一处修改即刻通知全部订阅者重渲染。
 */
export const settingsStore: SettingsStoreLike = new SettingsStore(new LocalStorageAdapter())

/** 为测试工厂：创建独立的存储实例（注入内存介质）。 */
export function createSettingsStore(storage: SettingsStorageLike): SettingsStoreLike {
  return new SettingsStore(storage)
}
