/**
 * Turn 工作记录组装:折叠日志 + 观测时间线 + 当前 git 变更 → TurnWorkRecord[]。
 *
 * 纯业务层:零框架依赖、无 I/O。mtime 精修经注入面
 * (`MtimeSource`,宿主对 git 变更列表 stat 后提供缓存)完成——
 * 不落盘,只在组装期现取(避免轮询噪声固化)。
 *
 * 归因规则(用户视角):
 *   - **内外互斥**:文件被本会话 agent 写过(任意 turn)→ 归其写入 turn 的
 *     internal,永不进 external(agent 重写旧文件 → 计该 turn internal);
 *   - **external(T)** = 窗口 [startAt, endAt/now] 内出现且从未被本会话写过的路径;
 *     窗口内出现 = 观测 firstSeenAt ∈ 窗口,或仍脏路径 mtime ∈ 窗口;
 *   - **记录三态**:仍在工作区 → dirty;HEAD 移动检测标注 → committed;
 *     其余(被还原/改动消失)→ reverted;
 *   - pill 单 turn 窗口起点 = 最近一个含工具调用的 turn(latestWorkTurn);
 *     窗口终点 = running ? now : turn/end。
 */

import type { FoldedTurn, TurnLog } from './turns.ts'
import { extractWritePaths, metaWritePaths, type ToolPresenter } from './write-paths.ts'
import type { ObservationLog } from './observation.ts'
import type { GitChange, GitChangeStatus } from './types.ts'
import type { PathStateLookup } from './path-state.ts'

/** 记录条目状态:仍变更 / 已提交 / 已还原(权威判定)/ 已离开待定。
 *
 * `reverted` 仅由权威探测(git log 无历史)得出;无法判定去向时一律
 * `gone`(中性,不再是过度断言)——旧实现把"无提交证据"直接标为
 * reverted,历史 turn 的文件(通常早已提交)被系统性误标。 */
export type WorkEntryState = 'dirty' | 'committed' | 'reverted' | 'gone'

/** 一条对外展示的工作记录条目。 */
export interface WorkEntry {
  readonly path: string
  readonly status: GitChangeStatus
  readonly state: WorkEntryState
  readonly firstSeenAt: number
}

/** 一个 turn 的对外工作记录。 */
export interface TurnWorkRecord {
  readonly turn: number
  readonly startAt: number
  readonly endAt: number | null
  /** 是否含工具调用(空 turn 折叠展示用)。 */
  readonly hasWork: boolean
  readonly internal: readonly WorkEntry[]
  readonly external: readonly WorkEntry[]
}

/** mtime 精修源:任意路径的修改时刻(宿主对 git 变更列表 stat 缓存;缺省无)。 */
export interface MtimeSource {
  mtime(path: string): number | undefined
}

/** 组装依赖。 */
export interface AssembleDeps {
  readonly log: TurnLog
  readonly observations: ObservationLog
  readonly changes: readonly GitChange[]
  readonly repoRoot: string
  readonly presenter: ToolPresenter | undefined
  readonly mtimes: MtimeSource | undefined
  readonly now: number
  /** 子会话写路径:父 turn → 路径(适配层注入;缺省无)。 */
  readonly subagentWrites?: ReadonlyMap<number, readonly string[]>
  /** 去向判定缓存(权威探测结果;缺省 = 全部待定 → gone)。 */
  readonly pathStates?: PathStateLookup
}

/**
 * 组装全部 turn 记录(升序;空 turn 也产出一条,hasWork=false)。
 * 内部先计算全局 internal 集合(内外互斥依赖),再逐 turn 取交集。
 */
export function assembleAll(deps: AssembleDeps): readonly TurnWorkRecord[] {
  const allInternal = collectAllInternal(deps)
  const internalPaths = new Set(allInternal.map((entry) => entry.path))
  return deps.log.turns.map((folded) => ({
    turn: folded.turn,
    startAt: folded.startAt,
    endAt: folded.endAt,
    hasWork: folded.toolCalls.length > 0,
    internal: internalOf(folded, deps),
    external: collectExternal(folded, internalPaths, deps),
  }))
}

/** 收集全部 turn 的 internal 条目(会话日志 agent 写路径 ∩ 工作区存在性)。 */
function collectAllInternal(deps: AssembleDeps): readonly WorkEntry[] {
  const entries: WorkEntry[] = []
  for (const folded of deps.log.turns) {
    entries.push(...internalOf(folded, deps))
  }
  return entries
}

/** 一个 turn 的 internal 条目。 */
function internalOf(folded: FoldedTurn, deps: AssembleDeps): readonly WorkEntry[] {
  const written = new Set<string>()
  for (const call of folded.toolCalls) {
    for (const path of extractWritePaths(call.name, call.argsJson, deps.repoRoot, deps.presenter)) {
      written.add(path)
    }
    if (call.meta !== undefined) {
      for (const path of metaWritePaths(call.meta)) {
        written.add(path)
      }
    }
  }
  // subagent 写路径(适配层按父 turn 归并)。
  for (const path of deps.subagentWrites?.get(folded.turn) ?? []) written.add(path)

  const entries: WorkEntry[] = []
  for (const path of written) {
    entries.push(entryFor(path, deps, folded.startAt))
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

/** 一个 turn 的 external 条目(窗口内出现 ∧ 全局未写)。 */
function collectExternal(
  folded: FoldedTurn,
  internalPaths: ReadonlySet<string>,
  deps: AssembleDeps,
): readonly WorkEntry[] {
  const windowStart = folded.startAt
  const windowEnd = folded.endAt ?? deps.now
  const entries: WorkEntry[] = []
  for (const observation of deps.observations.entries()) {
    if (internalPaths.has(observation.path)) continue
    const firstInWindow = observation.firstSeenAt >= windowStart && observation.firstSeenAt <= windowEnd
    const mtimeInWindow = deps.mtimes !== undefined
      ? (() => {
        const mtime = deps.mtimes.mtime(observation.path)
        return mtime !== undefined && mtime >= windowStart && mtime <= windowEnd
      })()
      : false
    if (!firstInWindow && !mtimeInWindow) continue
    const inChanges = deps.changes.some((change) => change.path === observation.path)
    const state = finalStateFor(observation.path, inChanges, observation, deps.pathStates)
    entries.push({
      path: observation.path,
      status: inChanges
        ? (deps.changes.find((change) => change.path === observation.path)?.status ?? observation.status)
        : observation.status,
      state,
      firstSeenAt: observation.firstSeenAt,
    })
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

/** 单个 entry 的去向判定(四态):
 *   - 在当前变更列表 → dirty;
 *   - 观测 HEAD 检测或权威缓存判定已提交 → committed(提交是最终事实,优先);
 *   - 权威探测确认未进入历史 → reverted;
 *   - 其余(无证据)→ gone(中性,待定)。 */
function finalStateFor(path: string, inChanges: boolean, observation: { readonly committedAt: number | null } | undefined, pathStates: PathStateLookup | undefined): WorkEntryState {
  if (inChanges) return 'dirty'
  const headDetected = observation?.committedAt !== null && observation?.committedAt !== undefined
  const final = pathStates?.get(path)
  if (headDetected || final === 'committed') return 'committed'
  if (final === 'reverted') return 'reverted'
  return 'gone'
}

/** 单条 entry:状态四态 + 当前/观测 status + 首见时刻。 */
function entryFor(path: string, deps: AssembleDeps, fallbackFirstSeenAt: number): WorkEntry {
  const observation = deps.observations.get(path)
  const inChanges = deps.changes.some((change) => change.path === path)
  const state = finalStateFor(path, inChanges, observation, deps.pathStates)
  return {
    path,
    status: inChanges
      ? (deps.changes.find((change) => change.path === path)?.status ?? 'modified')
      : (observation?.status ?? 'modified'),
    state,
    firstSeenAt: observation?.firstSeenAt ?? fallbackFirstSeenAt,
  }
}