/**
 * dsh 会话事件日志 → 业务切片的适配面。
 *
 * 本文件是 **唯一** 知道「dsh Session/事件真实形状」的地方的一部分:
 * `sliceEvents(session)` 把 `Session.events`(全量不可变快照)映射为
 * `TurnEventSlice[]`(turns.ts 的输入)。业务层按 seq 增量消费,
 * 重扫同一 seq 区间是幂等的。
 */

import type { TurnEventSlice } from '../../host/turns.ts'

/** dsh Session 的结构化切片(仅本适配器消费的成员)。 */
export interface SessionLike {
  readonly events: readonly SessionEventLike[]
  readonly seq: number
}

/** dsh SessionEvent 的结构化切片(只声明折叠关心的字段)。 */
export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

/** 把 dsh 会话事件映射为业务切片(超集字段剥除;未知类型不产出)。 */
export function sliceEvents(session: SessionLike | undefined): readonly TurnEventSlice[] {
  if (session === undefined) return []
  const slices: TurnEventSlice[] = []
  for (const event of session.events) {
    const slice = sliceEvent(event)
    if (slice !== null) slices.push(slice)
  }
  return slices
}

function sliceEvent(event: SessionEventLike): TurnEventSlice | null {
  const { type, seq, time, data } = event
  switch (type) {
    case 'turn/start': {
      const turn = numberField(data, 'turn')
      if (turn === null) return null
      return { type, seq, time, data: { turn } }
    }
    case 'turn/end': {
      const turn = numberField(data, 'turn')
      if (turn === null) return null
      return { type, seq, time, data: { turn } }
    }
    case 'tool/call': {
      const turn = numberField(data, 'turn')
      const name = stringField(data, 'name')
      const argumentsJson = stringField(data, 'arguments')
      const callId = stringField(data, 'callId')
      if (turn === null || name === null || argumentsJson === null || callId === null) return null
      return { type, seq, time, data: { turn, callId, name, arguments: argumentsJson } }
    }
    case 'tool/result': {
      const turn = numberField(data, 'turn')
      if (turn === null) return null
      // callId 位于 message.toolCallId(见 dsh-llm ToolResultMessage),
      // 事件级无该字段;meta 为工具私有载荷。
      const message = data.message
      const callId = typeof message === 'object' && message !== null
        ? stringField(message as Record<string, unknown>, 'toolCallId')
        : null
      const meta = data.meta
      return { type, seq, time, data: { turn, ...(callId !== null ? { callId } : {}), ...(meta !== undefined ? { meta } : {}) } }
    }
    case 'session/end-seed':
      return { type, seq, time, data: {} }
    default:
      return null
  }
}

function numberField(data: Record<string, unknown>, key: string): number | null {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return typeof value === 'string' ? value : null
}