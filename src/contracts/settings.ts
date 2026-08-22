/**
 * 设置契约层：Pill / 弹窗信息组件的可配置化规则。纯数据、零框架依赖。
 *
 * 设计原则（协议先行）：
 *   - 本文件只声明「规则」：组件清单、默认值、显示模式（预设）定义、
 *     派生规则、存储接口——不包含任何框架代码与 UI 实现。
 *   - 功能层（store 实现 / SettingsTab / Pill 渲染管道）全部建立在
 *     本协议之上；新增信息片段只需扩展类型与预设定义，渲染层零改动。
 *
 * 派生 vs 存储：`preset`（当前显示模式）不落盘，而是由 `presetOf()`
 * 从当前开关值纯派生——用户手改回与某一档完全一致时自动回位，
 * 无冗余状态、无歧义。
 */

/** localStorage 键名（带命名空间，避免与其他插件冲突）。 */
export const SETTINGS_STORAGE_KEY = 'dsh-git-ui.settings'

/** 存储格式版本：schema 不兼容变更时 +1，旧值按缺失字段回退默认。 */
export const SETTINGS_SCHEMA_VERSION = 1

/** 显示模式档位。'custom' 仅为派生结果，不作为规则表成员。 */
export type PresetId = 'minimal' | 'standard' | 'full' | 'custom'

/** 变更计数子项开关：三粒徽章各自独立（`+N` / `−N` / `?N`）。 */
export interface CountsSettings {
  readonly staged: boolean
  readonly modified: boolean
  readonly untracked: boolean
}

/** Pill 信息组件开关（会话头部胶囊上的展示单元）。 */
export interface PillSettings {
  /** 状态点（绿=干净 / 橙=有变更）。 */
  readonly dot: boolean
  /** 分支名称（含游离 HEAD / 无提交变体文案）。 */
  readonly branch: boolean
  /** 变更计数徽章组（子项见 CountsSettings）。 */
  readonly counts: CountsSettings
  /** 领先 / 落后徽章（`↑N ↓N`）。 */
  readonly sync: boolean
}

/** 详情弹窗信息组件开关。 */
export interface PopupSettings {
  /** 头部仓库根路径行。 */
  readonly rootPath: boolean
  /** 顶部统计条（staged / modified / untracked 数值）。 */
  readonly statusBar: boolean
  /** 头部分支切换器（关 = 纯文本分支名）。 */
  readonly branchSwitcher: boolean
  /** 新建分支输入行（创建并切换）。 */
  readonly branchCreate: boolean
  /** 最近提交条数（0 = 隐藏该区块；上限 MAX_RECENT_COMMITS）。 */
  readonly recentCommits: number
  /** 变更文件列表（含行内暂存 / 丢弃快捷操作）。 */
  readonly changesList: boolean
}

/** 完整 UI 设置（插件级全局、跨会话生效）。 */
export interface GitUISettings {
  readonly pill: PillSettings
  readonly popup: PopupSettings
}

/** 弹窗最近提交条数上限。 */
export const MAX_RECENT_COMMITS = 5

// ── 显示模式（预设）规则表 ────────────────────────────────────────────────

/** 一档显示模式的完整展开值（pill + popup 一体定义）。 */
export interface PresetDefinition {
  readonly id: Exclude<PresetId, 'custom'>
  readonly settings: GitUISettings
}

/** 极简：Pill 只留状态点与分支名；弹窗保持完整以支持点击后的深度操作。 */
const MINIMAL_UI: GitUISettings = {
  pill: {
    dot: true,
    branch: true,
    counts: { staged: false, modified: false, untracked: false },
    sync: false,
  },
  popup: {
    rootPath: true,
    statusBar: true,
    branchSwitcher: true,
    branchCreate: true,
    recentCommits: 3,
    changesList: true,
  },
}

/** 标准：当前既定行为（Pill 全量 + 弹窗全量 + 提交 3 条）。 */
const STANDARD_UI: GitUISettings = {
  pill: {
    dot: true,
    branch: true,
    counts: { staged: true, modified: true, untracked: true },
    sync: true,
  },
  popup: {
    rootPath: true,
    statusBar: true,
    branchSwitcher: true,
    branchCreate: true,
    recentCommits: 3,
    changesList: true,
  },
}

/** 完整：标准 + 弹窗最近提交拉满上限。 */
const FULL_UI: GitUISettings = {
  pill: { ...STANDARD_UI.pill },
  popup: { ...STANDARD_UI.popup, recentCommits: MAX_RECENT_COMMITS },
}

/** 显示模式规则表：档位定义集中于此，新增档位在表尾追加一行即可。 */
export const PRESETS: readonly PresetDefinition[] = [
  { id: 'minimal', settings: MINIMAL_UI },
  { id: 'standard', settings: STANDARD_UI },
  { id: 'full', settings: FULL_UI },
]

/** 默认设置 = 标准档（与既有行为完全一致）。 */
export const DEFAULT_SETTINGS: GitUISettings = STANDARD_UI

// ── 派生与变换规则（纯函数） ───────────────────────────────────────────────

/**
 * 从当前设置派生显示模式：与某一档完整一致 → 该档；否则 custom。
 * 纯派生、无存储，手改回档位值自动回位。
 */
export function presetOf(settings: GitUISettings): PresetId {
  for (const preset of PRESETS) {
    if (settingsEqual(settings, preset.settings)) return preset.id
  }
  return 'custom'
}

/** 应用一档显示模式：返回该档完整展开值（custom 无意义，原样返回）。 */
export function applyPreset(settings: GitUISettings, id: PresetId): GitUISettings {
  if (id === 'custom') return settings
  const preset = PRESETS.find((p) => p.id === id)
  return preset === undefined ? settings : preset.settings
}

/** 深层结构相等（仅本协议所涉字段；层层校验，避免浅比较陷阱）。 */
export function settingsEqual(a: GitUISettings, b: GitUISettings): boolean {
  return pillEqual(a.pill, b.pill) && popupEqual(a.popup, b.popup)
}

export function pillEqual(a: PillSettings, b: PillSettings): boolean {
  return a.dot === b.dot
    && a.branch === b.branch
    && a.sync === b.sync
    && countsEqual(a.counts, b.counts)
}

export function countsEqual(a: CountsSettings, b: CountsSettings): boolean {
  return a.staged === b.staged && a.modified === b.modified && a.untracked === b.untracked
}

export function popupEqual(a: PopupSettings, b: PopupSettings): boolean {
  return a.rootPath === b.rootPath
    && a.statusBar === b.statusBar
    && a.branchSwitcher === b.branchSwitcher
    && a.branchCreate === b.branchCreate
    && a.recentCommits === b.recentCommits
    && a.changesList === b.changesList
}

/** Pill 层局部补丁（counts 为可选子项补丁，缺省字段保留原值）。 */
export type PillPatch = Partial<{
  dot: boolean
  branch: boolean
  sync: boolean
  counts: Partial<CountsSettings>
}>

/** 弹窗层局部补丁（recentCommits 经 patchPopup 自动钳制到合法区间）。 */
export type PopupPatch = Partial<PopupSettings>

/** 应用 Pill 补丁（不可变更新；counts 子项浅合并）。 */
export function patchPill(prev: GitUISettings, patch: PillPatch): GitUISettings {
  return {
    ...prev,
    pill: {
      dot: patch.dot ?? prev.pill.dot,
      branch: patch.branch ?? prev.pill.branch,
      sync: patch.sync ?? prev.pill.sync,
      counts: {
        staged: patch.counts?.staged ?? prev.pill.counts.staged,
        modified: patch.counts?.modified ?? prev.pill.counts.modified,
        untracked: patch.counts?.untracked ?? prev.pill.counts.untracked,
      },
    },
  }
}

/** 应用弹窗补丁（不可变更新；recentCommits 自动钳制到 [0, MAX_RECENT_COMMITS]）。 */
export function patchPopup(prev: GitUISettings, patch: PopupPatch): GitUISettings {
  const recent = patch.recentCommits === undefined
    ? prev.popup.recentCommits
    : clampRecents(patch.recentCommits)
  return {
    ...prev,
    popup: {
      rootPath: patch.rootPath ?? prev.popup.rootPath,
      statusBar: patch.statusBar ?? prev.popup.statusBar,
      branchSwitcher: patch.branchSwitcher ?? prev.popup.branchSwitcher,
      branchCreate: patch.branchCreate ?? prev.popup.branchCreate,
      recentCommits: recent,
      changesList: patch.changesList ?? prev.popup.changesList,
    },
  }
}

/** 钳制弹窗提交条数到合法区间；非有限值回退默认设置（与 DEFAULT_SETTINGS 单一来源一致）。 */
export function clampRecents(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.popup.recentCommits
  return Math.min(MAX_RECENT_COMMITS, Math.max(0, Math.floor(value)))
}

// ── 存储协议 ───────────────────────────────────────────────────────────────

/** 持久化通道：实现方决定介质（浏览器 localStorage / 测试内存桩）。 */
export interface SettingsStorageLike {
  read(): string | null
  write(raw: string): void
}

/** 设置存储服务：业务层只依赖此接口（订阅 + 读取 + 覆盖）。 */
export interface SettingsStoreLike {
  get(): GitUISettings
  /** 以一份完整设置覆盖当前状态（不可变对象）。 */
  setSettings(next: GitUISettings): void
  /** 订阅变更；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
}
