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

/**
 * 旧版 localStorage 键名（带命名空间，避免与其他插件冲突）。
 * 仅作为历史迁移的读取源——v2 起主存储为宿主磁盘
 * `~/.dsh/plugin-data/dsh-git-ui/settings.json`，此键不再写入。
 */
export const SETTINGS_STORAGE_KEY = 'dsh-git-ui.settings'

/**
 * 存储格式版本：schema 不兼容变更时 +1。
 * v1 → v2：新增 `diff` 维度（字体大小 / 语法高亮 / 上下文折叠）。
 * 旧值经 migrateSettings 补默认字段（不丢既有偏好）。
 */
export const SETTINGS_SCHEMA_VERSION = 2

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
  /** 差异视图查看设置（独立维度：预设档位只覆盖 pill / popup 信息组合）。 */
  readonly diff: DiffSettings
}

/** 差异视图（变更对照 / 新增文件内容）查看参数。 */
export interface DiffSettings {
  /** 代码文字大小（px，钳制到 [MIN_DIFF_FONT_SIZE, MAX_DIFF_FONT_SIZE]）。 */
  readonly fontSize: number
  /** 按文件类型语法高亮（shiki；未知类型回落纯文本）。 */
  readonly syntaxHighlight: boolean
  /** 连续未变更上下文行超过阈值时折叠为可展开标记（长 diff 导航更省屏）。 */
  readonly foldContext: boolean
}

/** 差异代码字号下限。 */
export const MIN_DIFF_FONT_SIZE = 10
/** 差异代码字号上限。 */
export const MAX_DIFF_FONT_SIZE = 16
/** 差异代码字号默认值。 */
export const DEFAULT_DIFF_FONT_SIZE = 12

/** 连续未变更上下文行的折叠阈值（超过才折叠；与 foldContext 开关同用一个常量）。 */
export const DIFF_FOLD_THRESHOLD = 12

/** 差异视图默认参数。 */
export const DEFAULT_DIFF_SETTINGS: DiffSettings = {
  fontSize: DEFAULT_DIFF_FONT_SIZE,
  syntaxHighlight: true,
  foldContext: true,
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
  diff: DEFAULT_DIFF_SETTINGS,
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
  diff: DEFAULT_DIFF_SETTINGS,
}

/** 完整：标准 + 弹窗最近提交拉满上限。 */
const FULL_UI: GitUISettings = {
  pill: { ...STANDARD_UI.pill },
  popup: { ...STANDARD_UI.popup, recentCommits: MAX_RECENT_COMMITS },
  diff: DEFAULT_DIFF_SETTINGS,
}

/**
 * 显示模式规则表：档位定义集中于此，新增档位在表尾追加一行即可。
 * 预设只覆盖 Pill / 弹窗的信息组合；diff 视图参数为独立维度，
 * 不因档位切换而改变（`settingsEqual` 只比较前两者）。
 */
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

/**
 * 深层结构相等——「显示模式」语义：只比较 pill + popup 信息组合
 * （预设判定与档位回位均以此为准）；diff 视图参数为独立维度，
 * 调整它不把档位打回 custom。
 */
export function settingsEqual(a: GitUISettings, b: GitUISettings): boolean {
  return pillEqual(a.pill, b.pill) && popupEqual(a.popup, b.popup)
}

/** diff 视图参数深层相等。 */
export function diffEqual(a: DiffSettings, b: DiffSettings): boolean {
  return a.fontSize === b.fontSize && a.syntaxHighlight === b.syntaxHighlight && a.foldContext === b.foldContext
}

/** 全部字段（含 diff 维度）深层相等：重置按钮的禁用判定使用。 */
export function settingsEqualAll(a: GitUISettings, b: GitUISettings): boolean {
  return settingsEqual(a, b) && diffEqual(a.diff, b.diff)
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

/** 差异视图局部补丁（fontSize 经 patchDiff 自动钳制到合法区间）。 */
export type DiffPatch = Partial<DiffSettings>

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

/** 钳制差异字号到合法区间；非有限值回退默认字号。 */
export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DIFF_SETTINGS.fontSize
  return Math.min(MAX_DIFF_FONT_SIZE, Math.max(MIN_DIFF_FONT_SIZE, Math.floor(value)))
}

/** 应用差异视图补丁（不可变更新；fontSize 自动钳制到合法区间）。 */
export function patchDiff(prev: GitUISettings, patch: DiffPatch): GitUISettings {
  return {
    ...prev,
    diff: {
      fontSize: patch.fontSize === undefined ? prev.diff.fontSize : clampFontSize(patch.fontSize),
      syntaxHighlight: patch.syntaxHighlight ?? prev.diff.syntaxHighlight,
      foldContext: patch.foldContext ?? prev.diff.foldContext,
    },
  }
}

/**
 * 旧版（v1）设置迁入 v2：补上 diff 字段默认值，保留全部既有偏好。
 * 仅当存储信封的版本 < 当前版本时调用；diff 允许部分缺失（旧数据可能
 * 只带某个子字段），缺省子字段补默认。
 */
export function migrateSettings(settings: Omit<GitUISettings, 'diff'> & { readonly diff?: Partial<DiffSettings> }): GitUISettings {
  return {
    pill: settings.pill,
    popup: settings.popup,
    diff: { ...DEFAULT_DIFF_SETTINGS, ...(settings.diff ?? {}) },
  }
}

// ── 存储协议 ───────────────────────────────────────────────────────────────

/**
 * 持久化通道：实现方决定介质（v2 起为宿主磁盘
 * `~/.dsh/plugin-data/dsh-git-ui/settings.json`，经 host RPC；测试用内存桩）。
 * write 可能失败（reject）；调用方负责降级（内存态保留）。
 */
export interface SettingsPersistence {
  /** 读取原始文本；文件不存在解析为 null。 */
  read(): Promise<string | null>
  /** 写入原始文本（原子写由实现方保证）。 */
  write(raw: string): Promise<void>
}

/**
 * 遗留介质通道（v1：浏览器 localStorage）。仅作为初始化迁移的读取源——
 * v2 起主存储为宿主磁盘，本通道不再写入。
 */
export interface SettingsStorageLike {
  read(): string | null
  write(raw: string): void
}

/** 设置存储服务：业务层只依赖此接口（订阅 + 读取 + 覆盖 + 异步初始化）。 */
export interface SettingsStoreLike {
  get(): GitUISettings
  /** 以一份完整设置覆盖当前状态（不可变对象）；持久化为去抖异步，失败静默降级内存态。 */
  setSettings(next: GitUISettings): void
  /** 订阅变更；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /**
   * 异步初始化：注入持久化通道，读取 → 校验 → 迁移 → 生效并通知订阅者。
   * 幂等单飞：重复调用返回同一次加载。读取/解析失败静默保持当前内存态。
   */
  initialize(persistence: SettingsPersistence): Promise<void>
  /** 立即冲刷未落盘的变更（卸载 / 测试用）。 */
  flush(): Promise<void>
}
