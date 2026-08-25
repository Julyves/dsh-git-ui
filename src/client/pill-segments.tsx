/**
 * Pill 片段协议：Pill 胶囊的可插拔信息组件注册表与渲染管道。
 *
 * 协议（规则先行）：
 *   - 每个信息组件 = 一个 `PillSegment` 描述符：key / order（渲染顺序）/
 *     enabled（设置驱动的开关）/ render（节点）/ summary（无障碍文本）。
 *   - `renderPill()` 按 order 排序 → 按设置过滤 → 渲染为节点序列；
 *     **兜底规则**：全部片段被关闭时强制注入状态点（最小可见标识），
 *     任何设置组合都不会产生空胶囊。
 *
 * 扩展性：新增信息组件 = 在 PILL_SEGMENTS 追加一个描述符 + 在
 * `PillSettings` 中增加开关 + 设置 UI 一行；本管道与 GitPill 零改动。
 */
import type { ReactNode } from 'react'
import { CHIP_LETTERS } from './center/shared.ts'
import type { GitView } from './controller.ts'
import type { GitSnapshot, GitChangeStatus } from '../host/types.ts'
import type { CountsSettings, PillSettings } from '../contracts/settings.ts'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** 就绪视图的窄化类型。 */
export type ReadyView = GitView & { state: 'ready' }

/** 翻译函数窄化（与 GitPill 组件签名一致）。 */
export type T = (key: GitKey) => string

/** 片段键：与 PillSettings 字段一一对应。 */
export type PillSegmentKey = keyof PillSettings

/** 一个可插拔的 Pill 信息组件（设置驱动：render/summary 均接收完整设置）。 */
export interface PillSegment {
  readonly key: PillSegmentKey
  /** 渲染顺序（升序）。 */
  readonly order: number
  /** 设置驱动的开关判定。 */
  readonly enabled: (settings: PillSettings) => boolean
  /** 渲染节点（pill 内联样式由片段各自负责）。 */
  readonly render: (view: ReadyView, settings: PillSettings, t: T) => ReactNode
  /** 无障眼文本（button title / aria-label）；空串表示无文本贡献。 */
  readonly summary: (view: ReadyView, settings: PillSettings, t: T) => string
}

// ── 共享文本派生（pill 与弹窗复用） ──────────────────────────────────────

/** 变更计数徽章文本（按设置过滤子项，如 `+2 −1 ?3`）。 */
export function dirtyBadgeText(snapshot: GitSnapshot, counts: CountsSettings): string {
  const parts: string[] = []
  if (counts.staged && snapshot.staged > 0) parts.push(`+${snapshot.staged}`)
  if (counts.modified && snapshot.modified > 0) parts.push(`−${snapshot.modified}`)
  if (counts.untracked && snapshot.untracked > 0) parts.push(`?${snapshot.untracked}`)
  return parts.join(' ')
}

/** 领先 / 落后徽章文本（如 `↑1 ↓2`）。 */
export function syncBadgeText(snapshot: GitSnapshot): string {
  const parts: string[] = []
  if (snapshot.ahead > 0) parts.push(`↑${snapshot.ahead}`)
  if (snapshot.behind > 0) parts.push(`↓${snapshot.behind}`)
  return parts.join(' ')
}

/** 分支标签文本（普通分支 / 游离 HEAD + 短哈希 / 无提交变体）。 */
export function branchLabelText(snapshot: GitSnapshot, t: T): string {
  if (snapshot.branch === null) {
    return `(${t('pill.detached')}) · ${snapshot.head ?? ''}`
  }
  return snapshot.unborn ? `${snapshot.branch} · ${t('pill.noCommits')}` : snapshot.branch
}

// ── 片段注册表 ─────────────────────────────────────────────────────────────

/** 状态点：绿=干净 / 橙=有变更（最小编排单元）。 */
const DOT_SEGMENT: PillSegment = {
  key: 'dot',
  order: 10,
  enabled: (s) => s.dot,
  render: (view) => (
    <span style={view.snapshot.dirty ? css.dotDirty : css.dot} aria-hidden="true" />
  ),
  summary: () => '',
}

/** 分支名（椭圆收缩）。 */
const BRANCH_SEGMENT: PillSegment = {
  key: 'branch',
  order: 20,
  enabled: (s) => s.branch,
  render: (view, _settings, t) => <span style={css.pillBranch}>{branchLabelText(view.snapshot, t)}</span>,
  summary: (view, _settings, t) => branchLabelText(view.snapshot, t),
}

/** 变更计数徽章组（子项独立开关）。 */
const COUNTS_SEGMENT: PillSegment = {
  key: 'counts',
  order: 30,
  enabled: (s) => s.counts.staged || s.counts.modified || s.counts.untracked,
  render: (view, settings) => {
    const text = dirtyBadgeText(view.snapshot, settings.counts)
    return text === '' ? null : <span style={css.pillBadges}>{text}</span>
  },
  summary: (view, settings) => dirtyBadgeText(view.snapshot, settings.counts),
}

/** 领先 / 落后徽章。 */
const SYNC_SEGMENT: PillSegment = {
  key: 'sync',
  order: 40,
  enabled: (s) => s.sync,
  render: (view, _settings) => {
    const text = syncBadgeText(view.snapshot)
    return text === '' ? null : <span style={css.pillBadges}>{text}</span>
  },
  summary: (view) => syncBadgeText(view.snapshot),
}

/** 片段注册表：新增信息组件在此追加（协议扩展点）。 */
export const PILL_SEGMENTS: readonly PillSegment[] = [
  DOT_SEGMENT,
  BRANCH_SEGMENT,
  COUNTS_SEGMENT,
  SYNC_SEGMENT,
]

/** 最小可见标识：全关时的兜底片段。 */
export const MINIMAL_SEGMENT_KEY: PillSegmentKey = 'dot'

// ── 渲染管道 ───────────────────────────────────────────────────────────────

/** 按设置筛选 + 排序的启用片段列表（空时注入兜底片段）。 */
export function enabledSegments(settings: PillSettings): readonly PillSegment[] {
  const picked = PILL_SEGMENTS
    .filter((segment) => segment.enabled(settings))
    .sort((a, b) => a.order - b.order)
  if (picked.length > 0) return picked
  const minimal = PILL_SEGMENTS.find((s) => s.key === MINIMAL_SEGMENT_KEY)
  return minimal === undefined ? [] : [minimal]
}

/** 渲染结果：节点序列 + 摘要文本（用于 button title 等）。 */
export interface PillRender {
  readonly nodes: readonly ReactNode[]
  readonly summary: string
}

/** 按协议渲染整个 Pill（设置驱动；与设置面板预览共用，保证所见即所得）。 */
export function renderPill(view: ReadyView, settings: PillSettings, t: T): PillRender {
  const segments = enabledSegments(settings)
  const nodes: ReactNode[] = []
  const summaries: string[] = []
  for (const segment of segments) {
    const node = segment.render(view, settings, t)
    if (node !== null && node !== undefined) nodes.push(node)
    const text = segment.summary(view, settings, t)
    if (text !== '') summaries.push(text)
  }
  return { nodes, summary: summaries.join(' · ') }
}

/** 状态字母（弹窗变更行与 Git 中心共用）。 */
export function chipLetter(status: GitChangeStatus): string {
  return CHIP_LETTERS[status] ?? '•'
}

/** 弹窗头部徽章（与 Pill 设置一致；key 为结构性标识，供 React key 使用）。 */
export interface PopupBadge {
  readonly key: 'counts' | 'sync'
  readonly text: string
}

/** 弹窗头部徽章序列（与 Pill 设置一致的计数 / 同步徽章；供 GitPopupBody 复用）。 */
export function popupBadgeTexts(snapshot: GitSnapshot, settings: PillSettings): readonly PopupBadge[] {
  const badges: PopupBadge[] = []
  const counts = dirtyBadgeText(snapshot, settings.counts)
  if (counts !== '') badges.push({ key: 'counts', text: counts })
  if (settings.sync) {
    const sync = syncBadgeText(snapshot)
    if (sync !== '') badges.push({ key: 'sync', text: sync })
  }
  return badges
}
