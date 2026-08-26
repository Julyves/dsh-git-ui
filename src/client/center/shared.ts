/**
 * GitCenter 跨 tab 共享：分组键/类型、排序工具、状态字母表、数值钳制、
 * 时间格式化、壳 props 类型、历史分页与分支图常量。
 * 由 changes/ 与 history/ 子模块及 GitCenter 壳共享，避免重复定义。
 */
import type { GitAction, GitActionResult, GitChange, GitQueryRequest, GitSnapshot, TurnWorkRecord } from '../../host/types.ts'
import type { GitKey } from '../locales.ts'
import type { GitQueryOutcome } from '../controller.ts'
import { formatWhen } from '../time-format.ts'

/** Changes 分组键（IDEA 式三段：已暂存更改 / 更改 / 未版本控制的文件）。 */
export type ChangeGroupKey = 'staged' | 'unstaged' | 'untracked'

interface ChangeGroup {
  readonly key: ChangeGroupKey
  readonly labelKey: GitKey
  readonly items: readonly GitChange[]
}
export type { ChangeGroup }

/** 组内按路径字母序（IDEA 行为）。 */
export function byPath(a: GitChange, b: GitChange): number {
  return a.path.localeCompare(b.path)
}

/** 一条变更所属的分组键（IDEA 三段：已暂存/更改/未版本控制）。 */
export function groupKeyOfChange(c: GitChange): ChangeGroupKey {
  if (c.status === 'untracked') return 'untracked'
  return c.staged ? 'staged' : 'unstaged'
}

/** 数值钳制（Splitter 拖拽边界用）。 */
export function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

/** 历史列表分页大小。 */
export const HISTORY_PAGE = 300

// ── 差异对照视图占比（split 模式双列拖拽边界） ─────────────────────────────
/** 左列最小占比（20%——再窄则行号槽 + 代码不可读）。 */
export const DIFF_RATIO_MIN = 0.2
/** 左列最大占比（80%——右列对称下限）。 */
export const DIFF_RATIO_MAX = 0.8
/** 占比默认值（等分）。 */
export const DIFF_RATIO_DEFAULT = 0.5

/** 钳制差异对照占比到合法区间；非有限值回退默认（等分）。 */
export function clampDiffRatio(value: number): number {
  if (!Number.isFinite(value)) return DIFF_RATIO_DEFAULT
  return Math.min(DIFF_RATIO_MAX, Math.max(DIFF_RATIO_MIN, value))
}

/** IDEA 式时间：不足 60 分钟「x 分钟前」、今天/昨天 HH:mm，其余 Y/M/D HH:mm。 */
export function timeAgo(iso: string, now: number, t: (key: GitKey) => string): string {
  return formatWhen(iso, now, {
    minutesAgo: (n) => t('time.minutesAgo').replace('{n}', String(n)),
    today: t('time.today'),
    yesterday: t('time.yesterday'),
  })
}

/** 短时间（HH:mm，turn 记录时段窗用）。 */
export function shortTime(epochMs: number): string {
  const date = new Date(epochMs)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Tab 键：设置 Tab 与功能 Tab 并列（信息架构：工作区 + 偏好区）。 */
export type TabKey = 'changes' | 'history' | 'records' | 'settings'

/** GitCenter 的 Tab 键(供 GitPill 等调用方定位初始标签)。 */
export type GitCenterTab = TabKey

export interface GitCenterProps {
  readonly open: boolean
  readonly onClose: () => void
  /** 打开时定位的 Tab（默认 changes）；pill 齿轮入口传 settings。 */
  readonly initialTab?: TabKey
  readonly snapshot: GitSnapshot
  readonly run: (action: GitAction) => Promise<GitActionResult>
  readonly query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  readonly t: (key: GitKey) => string
  /** 打开定位：从 pill 点击变更文件而来——切到 changes 标签并打开该文件对照。 */
  readonly openRequest?: { readonly path: string; readonly base: 'worktree' | 'staged' } | null
  /** 打开定位：从 pill 点击最近提交而来——切到 history 标签并哈希直达选中
   *  （HistoryTab 经 focusRef 消费，B6 清过滤/H8 nonce 语义同记录页深链）。 */
  readonly commitRequest?: { readonly hash: string; readonly nonce: number } | null
  /** turn 工作记录(由 GitPill 统一拉取并下发;null = 未就绪/未开启)。 */
  readonly records?: readonly TurnWorkRecord[] | null
  /** records=null 时的失败态(true = 拉取失败;false/缺省 = 首次加载中)。
   *  BUG-R4:旧实现 null 一律渲染「加载失败」,慢仓库首屏秒级闪失败文案。 */
  readonly recordsFailed?: boolean
  /** 人工改判归因(仓库级持久化;缺省 = 记录页无纠错入口)。 */
  readonly onReclassify?: (path: string, to: 'internal' | 'sibling' | 'external') => void
}

/** 反馈条：text 为展示文案（业务错误经 i18n 友好化）；detail 保留原始信息供 title。 */
export type Feedback = { readonly text: string; readonly detail?: string } | null

export interface ToastState {
  readonly text: string
  readonly seq: number
}

// ── 分支图常量（history/CommitRow 共用） ──────────────────────────────────
/** 每车道理想像素宽。 */
export const GRAPH_COL_W = 16
/** 图轨道最大像素宽：超宽分支图压缩车道宽以适配。 */
export const GRAPH_MAX_TRACK_W = 192
/** 车道宽下限。 */
export const GRAPH_LANE_MIN_W = 8
/** 节点圆半径。 */
export const GRAPH_NODE_R = 4
/** 节点圆半径下限（车道压缩时同步缩小）。 */
export const GRAPH_NODE_MIN_R = 2
