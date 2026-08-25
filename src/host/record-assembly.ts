/**
 * Turn 工作记录组装:折叠日志 + 观测时间线 + 当前 git 变更 → TurnWorkRecord[]。
 *
 * 纯业务层:零框架依赖、无 I/O。mtime 精修经注入面
 * (`MtimeSource`,宿主对 git 变更列表 stat 后提供缓存)完成——
 * 不落盘,只在组装期现取(避免轮询噪声固化)。
 *
 * 归因规则(用户视角,三分作者):
 *   - **内外互斥**:文件被本会话 agent 写过(任意 turn)→ 归其写入 turn 的
 *     internal,永不进 sibling/external(agent 重写旧文件 → 计该 turn internal);
 *   - **sibling(T)** = 其他 dsh 会话(同工作区)AI 写过且未被本会话写的路径;
 *   - **external(T)** = 窗口 [startAt, endAt/now] 内出现、既非本会话也非兄弟
 *     会话写过的路径(人工:IDE / 命令行 / 未识别来源);
 *     窗口内出现 = 观测 firstSeenAt ∈ 窗口,或仍脏路径 mtime ∈ 窗口;
 *   - **记录四态**:仍在工作区 → dirty;HEAD 移动检测标注 → committed;
 *     权威探测确认未入历史 → reverted;其余 → gone(去向待定,中性);
 *   - pill 单 turn 窗口起点 = 最近一个含工具调用的 turn(latestWorkTurn);
 *     窗口终点 = running ? now : turn/end。
 */

import type { FoldedTurn, TurnLog } from './turns.ts'
import { extractWritePathDetails, metaWritePaths, type ToolPresenter, type WritePathDetail } from './write-paths.ts'
import type { ObservationLog } from './observation.ts'
import type { GitChange, TurnWorkRecord, WorkEntry, WorkEntryState } from './types.ts'
import type { PathStateLookup } from './path-state.ts'

// 记录契约单一来源:TurnWorkRecord / WorkEntry / WorkEntryState 以 types.ts
// 为权威(host 导出与 client zod 镜像都指向它),本模块仅消费并转发。
export type { TurnWorkRecord, WorkEntry, WorkEntryState } from './types.ts'

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
  /** 子会话写路径明细:父 turn → {path, authoritative}(适配层注入;缺省无)。 */
  readonly subagentWrites?: ReadonlyMap<number, readonly WritePathDetail[]>
  /** 其他 dsh 会话(同工作区)写过的路径全集(适配层注入;缺省 = 全落 external)。 */
  readonly siblingWrites?: ReadonlySet<string>
  /**
   * 权威写意图(L3 接口缝):turn → 该 turn 实际写入的路径集(上游沙箱
   * filesWritten)。命中的 turn 完全以此为准——旁路全部启发式提取,
   * attribution 恒 authoritative;未命中的 turn 走现行管线。
   */
  readonly filesWrittenByTurn?: ReadonlyMap<number, readonly string[]>
  /** 去向判定缓存(权威探测结果;缺省 = 全部待定 → gone)。 */
  readonly pathStates?: PathStateLookup
  /**
   * turn 边界指纹(L4):turn → 边界时刻变更路径集。条目 fresh 标记 =
   * 路径不在**上一 turn 边界指纹**中(本轮新增)。缺省 → fresh 恒缺省。
   */
  readonly fingerprints?: ReadonlyMap<number, ReadonlySet<string>>
}

/**
 * 组装全部 turn 记录(升序;空 turn 也产出一条,hasWork=false)。
 * 内部先计算全局 internal 集合(内外互斥依赖),再逐 turn 取交集。
 */
export function assembleAll(deps: AssembleDeps): readonly TurnWorkRecord[] {
  const allInternal = collectAllInternal(deps)
  const internalPaths = new Set(allInternal.map((entry) => entry.path))
  const turns = deps.log.turns
  return turns.map((folded, index) => {
    const prev = index > 0 ? turns[index - 1] : undefined
    const nonInternal = collectNonInternal(folded, internalPaths, deps, prev?.endAt)
    // L4 fresh:上一 turn 的边界指纹在场且不含该路径 → 本轮新增。
    const prevFp = deps.fingerprints !== undefined && prev !== undefined
      ? deps.fingerprints.get(prev.turn)
      : undefined
    const withFresh = (entry: WorkEntry): WorkEntry =>
      prevFp !== undefined && !prevFp.has(entry.path) ? { ...entry, fresh: true } : entry
    return {
      turn: folded.turn,
      startAt: folded.startAt,
      endAt: folded.endAt,
      hasWork: folded.toolCalls.length > 0,
      narrative: folded.narrative,
      internal: internalOf(folded, deps).map(withFresh),
      sibling: nonInternal.sibling.map(withFresh),
      external: nonInternal.external.map(withFresh),
    }
  })
}

/** 收集全部 turn 的 internal 条目(会话日志 agent 写路径 ∩ 工作区存在性)。 */
function collectAllInternal(deps: AssembleDeps): readonly WorkEntry[] {
  const entries: WorkEntry[] = []
  for (const folded of deps.log.turns) {
    entries.push(...internalOf(folded, deps))
  }
  return entries
}

/** 一个 turn 的 internal 条目(含归因置信度:平台自证 vs 启发式推断)。 */
function internalOf(folded: FoldedTurn, deps: AssembleDeps): readonly WorkEntry[] {
  // L3 权威通道:上游 filesWritten 命中该 turn → 完全以其为准(旁路启发式)。
  const authoritativeSet = deps.filesWrittenByTurn?.get(folded.turn)
  if (authoritativeSet !== undefined) {
    const entries = [...new Set(authoritativeSet)]
      .map((path) => ({ ...entryFor(path, deps, folded.startAt), attribution: 'authoritative' as const }))
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }
  // path → 权威?同一路径权威源与启发式并存时权威胜(写意图自证优先)。
  const authority = new Map<string, boolean>()
  const mark = (path: string, authoritative: boolean): void => {
    const existing = authority.get(path)
    authority.set(path, existing === true ? true : authoritative)
  }
  for (const call of folded.toolCalls) {
    for (const detail of extractWritePathDetails(call.name, call.argsJson, deps.repoRoot, deps.presenter)) {
      mark(detail.path, detail.authoritative)
    }
    if (call.meta !== undefined) {
      // result meta diff = 平台结果期自证 → 权威。
      for (const path of metaWritePaths(call.meta, deps.repoRoot)) mark(path, true)
    }
  }
  // subagent 写路径明细(适配层按父 turn 归并)。
  for (const detail of deps.subagentWrites?.get(folded.turn) ?? []) mark(detail.path, detail.authoritative)

  const entries: WorkEntry[] = []
  for (const [path, authoritative] of authority) {
    entries.push({ ...entryFor(path, deps, folded.startAt), attribution: authoritative ? 'authoritative' : 'inferred' })
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

/** 一个 turn 的非 internal 条目(窗口内出现 ∧ 全局未被本会话写过),
 * 按兄弟会话写路径全集再切分为 sibling(AI)与 external(人工)两组。
 *
 * 窗口 = 主区间 [startAt, endAt](闭,语义不变)**∪ 间隙半开区间
 * (prevEnd, startAt)**(存在时):turn 间隔里出现/修改的条目归**下一
 * turn**(间隙归属,消灭真空)。半开设计避免与上一 turn 的闭区间端点
 * 重叠——firstSeenAt === prevEnd 的条目只归上一 turn,不双归。 */
function collectNonInternal(
  folded: FoldedTurn,
  internalPaths: ReadonlySet<string>,
  deps: AssembleDeps,
  prevEnd: number | null | undefined,
): { sibling: readonly WorkEntry[]; external: readonly WorkEntry[] } {
  const windowStart = folded.startAt
  const windowEnd = folded.endAt ?? deps.now
  const sibling: WorkEntry[] = []
  const external: WorkEntry[] = []
  for (const observation of deps.observations.entries()) {
    if (internalPaths.has(observation.path)) continue
    const firstSeen = observation.firstSeenAt
    const firstInWindow = firstSeen >= windowStart && firstSeen <= windowEnd
    const firstInGap = prevEnd !== null && prevEnd !== undefined && firstSeen > prevEnd && firstSeen < windowStart
    const mtime = deps.mtimes?.mtime(observation.path)
    const mtimeInWindow = mtime !== undefined && mtime >= windowStart && mtime <= windowEnd
    const mtimeInGap = prevEnd !== null && prevEnd !== undefined && mtime !== undefined && mtime > prevEnd && mtime < windowStart
    if (!firstInWindow && !firstInGap && !mtimeInWindow && !mtimeInGap) continue
    const inChanges = deps.changes.some((change) => change.path === observation.path)
    const state = finalStateFor(observation.path, inChanges, observation, deps.pathStates)
    const entry: WorkEntry = {
      path: observation.path,
      status: inChanges
        ? (deps.changes.find((change) => change.path === observation.path)?.status ?? observation.status)
        : observation.status,
      state,
      firstSeenAt: observation.firstSeenAt,
      commitHash: observation.commitHash,
      // 观测窗口归因(非写意图自证)→ 一律推断。
      attribution: 'inferred',
    }
    // 本会话与兄弟会话共写 → internal 胜(全局互斥);仅兄弟写过 → sibling。
    // 判定源二合一:时间线上已固化的 author 标记(P1-2 持久化,兄弟离场/
    // 重启后仍成立)∨ 当前 live 兄弟写集(固化发生在组装同轮,双保险)。
    if (observation.author === 'sibling' || deps.siblingWrites?.has(observation.path) === true) sibling.push(entry)
    else external.push(entry)
  }
  const byPath = (a: WorkEntry, b: WorkEntry): number => a.path.localeCompare(b.path)
  return { sibling: sibling.sort(byPath), external: external.sort(byPath) }
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

/** 单条 entry:状态四态 + 当前/观测 status + 首见时刻 + 提交哈希
 * (attribution 由调用方覆盖:internal 按提取来源,观测条目恒 inferred)。 */
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
    commitHash: observation?.commitHash ?? null,
    attribution: 'inferred',
  }
}