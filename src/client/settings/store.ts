/**
 * 设置存储实现：契约 `SettingsStoreLike` 的浏览器默认实现。
 *
 * 存储拓扑（v2，破坏性迁移——开发阶段无兼容包袱）：
 *   - **主存储**：宿主磁盘 `~/.dsh/plugin-data/dsh-git-ui/settings.json`
 *     （经 host RPC `storageWrite` / `storageRead`，原子写、跨设备重启存活）；
 *   - 内存态：模块级单例 + useSyncExternalStore 形状（与 GitController 同构），
 *     UI 即时响应，持久化去抖异步落盘（300ms），失败静默降级内存态；
 *   - **迁移源**：v1 的 localStorage 旧值仅在初始化读取一次（host 无数据时
 *     采用并写回 host），之后不再读写该键。
 *
 * 校验：zod schema + 版本信封；损坏 / 旧版一律回退默认（v1 补 diff 默认值，
 * 不丢既有偏好）。
 */
import {
  DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, SETTINGS_STORAGE_KEY,
  migrateSettings, type GitUISettings, type SettingsPersistence, type SettingsStoreLike, type SettingsStorageLike,
} from '../../contracts/settings.ts'
import type { GitRemoteLike } from '../../contracts/client-platform.ts'
import { settingsEnvelopeSchema } from './schema.ts'

/** 持久化去抖窗口（ms）：设置面板连续拨动开关时合并为一次写盘。 */
const PERSIST_DEBOUNCE_MS = 300

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

/**
 * 从持久化原始文本解析设置。
 * 信封版本 <= 当前 → 统一经 migrateSettings 补齐 diff 默认（当前版本
 * 数据幂等；旧数据不丢偏好）；更高版本（降级）→ 默认。
 * 任何异常 → 默认（宁可丢偏好，不可产出坏 UI）。
 */
function parseSettings(raw: string | null): GitUISettings {
  if (raw === null) return DEFAULT_SETTINGS
  try {
    const parsed = settingsEnvelopeSchema.parse(JSON.parse(raw))
    if (parsed.v > SETTINGS_SCHEMA_VERSION) return DEFAULT_SETTINGS
    // migrateSettings 对完整 v2 数据幂等（diff 已齐则原样保留）；
    // 对缺 diff 的旧数据补默认——因此不依赖 `as` 断言，杜绝坏字段穿透。
    return migrateSettings(parsed.settings)
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** 序列化当前设置（与 parseSettings 对称）。 */
function serializeSettings(settings: GitUISettings): string {
  return JSON.stringify({ v: SETTINGS_SCHEMA_VERSION, settings })
}

class SettingsStore implements SettingsStoreLike {
  private state: GitUISettings
  private readonly listeners = new Set<() => void>()
  /** 异步初始化的单飞句柄。 */
  private loadPromise: Promise<void> | null = null
  /** 当前持久化通道（initialize 后有效）。 */
  private persistence: SettingsPersistence | null = null
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  /** 存在未落盘变更。 */
  private dirty = false
  /** 遗留 localStorage 迁移源（仅读；写入已废弃）。 */
  private readonly legacy: SettingsStorageLike | null
  /** 构造时的初始值：加载结果只覆盖「用户尚未修改」的 state（防竞态覆盖）。 */
  private readonly initial: GitUISettings

  constructor(legacy: SettingsStorageLike | null = null) {
    this.legacy = legacy
    this.state = legacy === null ? DEFAULT_SETTINGS : parseSettings(legacy.read())
    this.initial = this.state
  }

  get(): GitUISettings {
    return this.state
  }

  setSettings(next: GitUISettings): void {
    if (next === this.state) return
    this.state = next
    for (const listener of [...this.listeners]) listener()
    this.schedulePersist()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  initialize(persistence: SettingsPersistence): Promise<void> {
    if (this.loadPromise !== null) return this.loadPromise
    this.persistence = persistence
    this.loadPromise = this.loadFrom(persistence)
    return this.loadPromise
  }

  flush(): Promise<void> {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    return this.persistNow()
  }

  /** 初始化加载：host 优先；缺失时迁移旧 localStorage；加载不覆盖用户已做的修改。 */
  private async loadFrom(persistence: SettingsPersistence): Promise<void> {
    let loaded: GitUISettings | null = null
    try {
      const raw = await persistence.read()
      if (raw !== null) loaded = parseSettings(raw)
    } catch {
      // 读取失败（RPC/网关不可达等）：保持当前内存态（默认或已迁移值）。
    }
    // host 无数据 → 尝试从 v1 localStorage 迁移（不覆盖已加载值）。
    if (loaded === null && this.legacy !== null) {
      const legacy = this.legacy.read()
      if (legacy !== null) loaded = parseSettings(legacy)
    }
    // 加载结果只覆盖「用户尚未修改」的 state：异步初始化期间用户若已
    // 调整设置（首次渲染前打开面板等极早场景），保留用户内存值并把该值
    // 落盘（下方 flush 写的是当前 this.state）。
    if (loaded !== null && this.state === this.initial) {
      this.state = loaded
      for (const listener of [...this.listeners]) listener()
    }
    // 迁移或首次就绪：回写 host 落盘（await——初始化完成后数据已持久化，
    // 调用方（测试/上层）无需再等 write 微任务）。
    if (this.persistence !== null && (loaded !== null || this.dirty)) {
      this.dirty = true
      await this.flush().catch(() => {})
    }
  }

  /** 写盘链（串行化）：flush 与去抖落盘可能并发，链式排列保证写序与不重叠。 */
  private persistChain: Promise<void> = Promise.resolve()

  private schedulePersist(): void {
    if (this.persistence === null) return
    this.dirty = true
    if (this.writeTimer !== undefined) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.persistNow().catch(() => {
        // 落盘失败：内存态保留（用户无感知；下次变更重试）。
      })
    }, PERSIST_DEBOUNCE_MS)
  }

  private persistNow(): Promise<void> {
    if (!this.dirty || this.persistence === null) return Promise.resolve()
    this.dirty = false
    const snapshot = serializeSettings(this.state)
    // 链式串行：同一时刻至多一次写；前一轮失败（reject）不阻断后续写。
    this.persistChain = this.persistChain
      .catch(() => {})
      .then(() => this.persistence!.write(snapshot))
    return this.persistChain
  }
}

/**
 * 模块级单例（浏览器内存）：GitPill / GitCenter / SettingsTab 共享同一实例，
 * 任何一处修改即刻通知全部订阅者重渲染。
 * 主存储经 host RPC（apply 时 `initialize(hostPersistence(remote))`），
 * localStorage 仅作迁移源。
 */
export const settingsStore: SettingsStoreLike = new SettingsStore(new LocalStorageAdapter())

/** 为测试工厂：创建独立的存储实例（注入遗留桩；持久化通道经 initialize 注入）。 */
export function createSettingsStore(legacy: SettingsStorageLike | null = null): SettingsStoreLike {
  return new SettingsStore(legacy)
}

/**
 * 把 host RPC 的 gitInfo 服务适配为设置持久化通道。
 * 注意 RPC 信封双层：外层是传输结果（ok/error），内层是业务
 * GitStorageReadResult / GitStorageWriteResult。
 */
export function hostPersistence(remote: GitRemoteLike): SettingsPersistence {
  return {
    async read() {
      const envelope = await remote.storageRead({ file: 'settings.json' })
      if (!envelope.ok) return null
      const inner = envelope.value
      return inner.ok ? inner.value : null
    },
    async write(raw) {
      const envelope = await remote.storageWrite({ file: 'settings.json', data: raw })
      if (!envelope.ok) throw new Error('settings persist failed')
      if (!envelope.value.ok) throw new Error(`settings persist failed: ${envelope.value.error.message}`)
    },
  }
}
