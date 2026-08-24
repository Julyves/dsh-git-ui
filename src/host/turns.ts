/**
 * 会话事件日志 → per-turn 工作窗口与工具条目的折叠器。
 *
 * 纯业务层:零框架依赖、无 I/O;输入为手写镜像的 SessionEvent 最小切片
 * (适配层 `adapters/dsh/session-log.ts` 负责把 dsh 真实事件映射为切片)。
 *
 * 折叠语义:
 *   - `turn/start{turn}` 开启窗口,`turn/end{turn}` 关闭;缺 end 且为最大 turn
 *     视为进行中(running,窗口截止 = 组装时的 now);
 *   - `tool/call{turn, name, arguments}` 挂入所属 turn;日志按 seq 递增,
 *     turn/start 恒先于同 turn 的 tool/call,因此增量折叠安全:
 *     只需处理 `seq >= foldedUpToSeq` 的新事件;
 *   - `session/end-seed` 是恢复/派生历史边界:调用方对**子会话**日志传入
 *     fromSeq(= 最后一个 end-seed 之后),父会话则从 0 折叠(其 seed 是
 *     自己的持久化历史,属于同一会话的工作);
 *   - 空 turn(无工具调用)保留在列表,但 `latestWorkTurn()` 只为携带工具
 *     调用的 turn 服务(pill 单 turn 窗口的起点判定)。
 */

/** 折叠关心的会话事件最小切片(hand-mirror dsh session 事件;超集字段忽略)。 */
export type TurnEventSlice =
  | { readonly type: 'turn/start'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number } }
  | { readonly type: 'turn/end'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number } }
  | { readonly type: 'tool/call'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number; readonly step?: number; readonly callId: string; readonly name: string; readonly arguments: string } }
  | { readonly type: 'tool/result'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number; readonly step?: number; readonly callId?: string; readonly meta?: unknown } }
  | { readonly type: 'session/end-seed'; readonly seq: number; readonly time: number; readonly data: Record<string, never> }
  | { readonly type: 'user/message'; readonly seq: number; readonly time: number; readonly data: { readonly text: string } }

/** 一条 turn 内的工具调用记录(写路径提取的输入)。 */
export interface ToolCallRecord {
  readonly name: string
  /** 工具调用的 callId(与 tool/result 配对)。 */
  readonly callId: string
  /** 模型原文 args JSON(未经解析/清洗)。 */
  readonly argsJson: string
  readonly turn: number
  /** tool/call 事件的 Unix 毫秒时间戳。 */
  readonly at: number
  /** 匹配的 tool/result 携带的 meta 原文(JSON 可序列化;双源提取用)。 */
  readonly meta: unknown
}

/** 一个 turn 的折叠结果(只读视图;宿主内部状态,勿从外部修改)。 */
export interface FoldedTurn {
  readonly turn: number
  /** turn/start 的 Unix 毫秒时间戳。 */
  readonly startAt: number
  /** turn/end 的 Unix 毫秒时间戳;null = 进行中。 */
  readonly endAt: number | null
  /** 驱动该 turn 的用户指令摘要(首个 user/message;null = 无/未捕获)。 */
  readonly narrative: string | null
  readonly toolCalls: readonly ToolCallRecord[]
}

/** 内部可变形态(与对外只读视图结构兼容,避免逐字段拷贝)。 */
interface MutableTurn {
  turn: number
  startAt: number
  endAt: number | null
  narrative: string | null
  /** 叙事来源:true = 折叠器从事件新捕获(优先级最高,可覆盖恢复值)。 */
  narrativeFresh: boolean
  toolCalls: ToolCallRecord[]
}

/**
 * 会话 turn 折叠状态(每会话一份,宿主内存持有)。
 * 增量语义:`append` 只处理 `seq >= foldedUpToSeq` 的新事件;
 * 无新事件时内部零改动(廉价幂等)。
 */
export class TurnLog {
  private readonly list: MutableTurn[] = []
  private readonly index = new Map<number, MutableTurn>()
  private seq = 0
  /** 最近一次 turn/start 的记录(叙事挂靠点:驱动该 turn 的用户指令)。 */
  private openTurn: MutableTurn | null = null

  /** 已折叠的最大事件 seq(不含);新增事件从该值起处理。 */
  get foldedUpToSeq(): number {
    return this.seq
  }

  get turns(): readonly FoldedTurn[] {
    return this.list
  }

  /**
   * 处理一批新事件。`fromSeq` 可选:跳过该 seq 之前的事件
   * (子会话日志的 seed 边界过滤由调用方预先算好传参——见模块注释)。
   * 返回本次新捕获叙事的 turn 号列表(持久化 dirty 判定用)。
   */
  append(events: readonly TurnEventSlice[], fromSeq = 0): readonly number[] {
    const narrated: number[] = []
    for (const event of events) {
      if (event.seq < fromSeq || event.seq < this.seq) continue
      // seq 乱序(损坏/重复注入)时忽略并保持游标连续:seq = log.length 契约,
      // 后置事件重复处理会 double-count,前置 none。此处按事件顺序单调推进。
      this.seq = event.seq + 1
      switch (event.type) {
        case 'turn/start': {
          const turn = event.data.turn
          if (this.index.has(turn)) continue
          const record: MutableTurn = {
            turn,
            startAt: event.time,
            endAt: null,
            narrative: null,
            narrativeFresh: false,
            toolCalls: [],
          }
          this.list.push(record)
          this.index.set(turn, record)
          this.openTurn = record
          break
        }
        case 'turn/end': {
          const record = this.index.get(event.data.turn)
          if (record !== undefined && record.endAt === null) {
            record.endAt = event.time
          }
          break
        }
        case 'user/message': {
          // 叙事:turn/start 后的首条用户指令(多条/批量时首条即标题);
          // 事件已过 compaction 折叠或先于任何 turn/start → 无挂靠点,忽略。
          // 新捕获可覆盖恢复值(narrativeFresh 优先)——恢复与折叠的完成
          // 顺序不确定,磁盘旧值不得挡住仍在事件日志里的新鲜文本。
          if (this.openTurn !== null && !this.openTurn.narrativeFresh) {
            this.openTurn.narrative = clampNarrative(event.data.text)
            this.openTurn.narrativeFresh = true
            narrated.push(this.openTurn.turn)
          }
          break
        }
        case 'tool/call': {
          const record = this.index.get(event.data.turn)
          if (record === undefined) continue // 无 turn/start 的孤立调用(损坏日志)——忽略
          record.toolCalls.push({
            name: event.data.name,
            callId: event.data.callId,
            argsJson: event.data.arguments,
            turn: event.data.turn,
            at: event.time,
            meta: undefined,
          })
          break
        }
        case 'tool/result': {
          // meta 双源:按 toolCallId 精确定位所属调用(并行调用不误配);
          // 不带 callId 时(降级切片)回退到最近一次调用。
          const record = this.index.get(event.data.turn)
          if (record === undefined || record.toolCalls.length === 0) continue
          const meta = event.data.meta
          if (meta === undefined || meta === null) break
          const index = event.data.callId === undefined
            ? record.toolCalls.length - 1
            : findCallIndex(record.toolCalls, event.data.callId)
          if (index < 0) break
          const target = record.toolCalls[index]
          if (target === undefined) break
          record.toolCalls[index] = { ...target, meta }
          break
        }
        default:
          break
      }
    }
    return narrated
  }

  /** 恢复持久化叙事(宿主重启后 compaction 已折叠旧 user/message 事件)。
   * 仅填补未被折叠器捕获过的槽位——事件日志里的新鲜文本优先于磁盘旧值。 */
  restoreNarratives(entries: ReadonlyArray<readonly [number, string]>): void {
    for (const [turn, narrative] of entries) {
      const record = this.index.get(turn)
      if (record !== undefined && !record.narrativeFresh && record.narrative === null && narrative !== '') {
        record.narrative = narrative
      }
    }
  }

  /** 全量导出叙事(落盘用)。 */
  narratives(): ReadonlyArray<readonly [number, string]> {
    const out: Array<readonly [number, string]> = []
    for (const record of this.list) {
      if (record.narrative !== null) out.push([record.turn, record.narrative])
    }
    return out
  }

  /**
   * 最近一次携带工具调用的 turn(pill 单 turn 窗口起点);无 → null。
   * 空 turn 不参与工作窗口(用户视角:纯提问不算工作时段)。
   */
  latestWorkTurn(): FoldedTurn | null {
    for (let index = this.list.length - 1; index >= 0; index -= 1) {
      const turn = this.list[index]
      if (turn !== undefined && turn.toolCalls.length > 0) return turn
    }
    return null
  }
}

/** 在 turn 的工具调用中按 callId 定位(从尾部反向查找,result 恒在 call 之后)。 */
function findCallIndex(calls: readonly ToolCallRecord[], callId: string): number {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (calls[index]?.callId === callId) return index
  }
  return -1
}

/** 叙事长度上限(字符):标题用途,超长截断。 */
export const NARRATIVE_MAX_CHARS = 80

/** 整理为单行标题:折叠空白 + 截断(NARRATIVE_MAX_CHARS + 省略号)。 */
function clampNarrative(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= NARRATIVE_MAX_CHARS) return normalized
  return `${normalized.slice(0, NARRATIVE_MAX_CHARS)}…`
}