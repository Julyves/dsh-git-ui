import { describe, expect, it } from 'vitest'
import { TurnLog, type TurnEventSlice } from '../src/host/turns.ts'

function turnStart(seq: number, turn: number, time: number): TurnEventSlice {
  return { type: 'turn/start', seq, time, data: { turn } }
}
function turnEnd(seq: number, turn: number, time: number): TurnEventSlice {
  return { type: 'turn/end', seq, time, data: { turn } }
}
function toolCall(seq: number, turn: number, callId: string, name: string, args: string, time: number): TurnEventSlice {
  return { type: 'tool/call', seq, time, data: { turn, callId, name, arguments: args } }
}
function toolResult(seq: number, turn: number, callId: string, meta: unknown, time: number): TurnEventSlice {
  return { type: 'tool/result', seq, time, data: { turn, callId, meta } }
}

describe('TurnLog fold', () => {
  it('folds turn windows with exact timestamps', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      toolCall(2, 1, 'c1', 'write', '{}', 1100),
      turnEnd(3, 1, 2000),
      turnStart(4, 2, 3000),
      toolCall(5, 2, 'c2', 'bash', '{}', 3100),
    ])
    expect(log.turns).toHaveLength(2)
    expect(log.turns[0]).toMatchObject({ turn: 1, startAt: 1000, endAt: 2000 })
    expect(log.turns[0]?.toolCalls).toHaveLength(1)
    expect(log.foldedUpToSeq).toBe(6)
  })

  it('marks the latest turn running when end is absent', () => {
    const log = new TurnLog()
    log.append([turnStart(1, 1, 1000), turnEnd(2, 1, 2000), turnStart(3, 2, 3000)])
    expect(log.turns[1]).toMatchObject({ turn: 2, startAt: 3000, endAt: null })
  })

  it('latestWorkTurn skips empty turns (no tool calls)', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      toolCall(2, 1, 'c1', 'write', '{}', 1100),
      turnEnd(3, 1, 2000),
      turnStart(4, 2, 3000), // 空 turn:纯提问
      turnEnd(5, 2, 4000),
    ])
    expect(log.latestWorkTurn()).toMatchObject({ turn: 1, startAt: 1000 })
  })

  it('returns null when no turn ever had tool calls', () => {
    const log = new TurnLog()
    log.append([turnStart(1, 1, 1000), turnEnd(2, 1, 2000)])
    expect(log.latestWorkTurn()).toBeNull()
  })

  it('is incremental: appending same events is a no-op', () => {
    const log = new TurnLog()
    const events = [turnStart(1, 1, 1000), toolCall(2, 1, 'c1', 'write', '{}', 1100), turnEnd(3, 1, 2000)]
    log.append(events)
    const first = log.turns[0]
    log.append(events) // 重复注入(seq 已折叠)→ 忽略
    expect(log.turns).toHaveLength(1)
    expect(log.turns[0]?.toolCalls).toHaveLength(1)
    log.append([turnStart(4, 2, 3000), toolCall(5, 2, 'c2', 'bash', '{}', 3100)])
    expect(log.turns).toHaveLength(2)
    expect(first?.toolCalls).toHaveLength(1) // 旧 turn 不被触碰
  })

  it('associates result meta with the exact callId (parallel calls)', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      toolCall(2, 1, 'a', 'write', '{"file_path":"x.ts"}', 1100),
      toolCall(3, 1, 'b', 'bash', '{"command":"echo hi"}', 1150),
      toolResult(4, 1, 'a', { diffs: [{ path: 'x.ts' }] }, 1200),
    ])
    expect(log.turns[0]?.toolCalls[0]?.meta).toEqual({ diffs: [{ path: 'x.ts' }] })
    expect(log.turns[0]?.toolCalls[1]?.meta).toBeUndefined()
  })

  it('falls back to the latest call when callId is absent', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      toolCall(2, 1, 'a', 'write', '{}', 1100),
      { type: 'tool/result', seq: 3, time: 1200, data: { turn: 1, meta: { diffs: [{ path: 'y.ts' }] } } },
    ])
    expect(log.turns[0]?.toolCalls[0]?.meta).toEqual({ diffs: [{ path: 'y.ts' }] })
  })

  it('honors fromSeq (subagent seed boundary): skips seed events', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      toolCall(2, 1, 'c1', 'write', '{}', 1100),
      turnEnd(3, 1, 2000),
      turnStart(4, 2, 3000),
      toolCall(5, 2, 'c2', 'write', '{}', 3100),
      turnEnd(6, 2, 4000),
    ], 4) // 从 seq 4 起(最后一个 end-seed 之后)
    expect(log.turns).toHaveLength(1)
    expect(log.turns[0]).toMatchObject({ turn: 2, startAt: 3000, endAt: 4000 })
  })

  it('ignores orphan tool calls without a turn window', () => {
    const log = new TurnLog()
    log.append([toolCall(1, 5, 'c1', 'write', '{}', 1100)])
    expect(log.turns).toHaveLength(0)
  })

  it('ignores unknown event types without throwing', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      { type: 'assistant/message', seq: 2, time: 1500, data: {} } as unknown as TurnEventSlice,
      turnEnd(3, 1, 2000),
    ])
    expect(log.turns).toHaveLength(1)
    expect(log.foldedUpToSeq).toBe(4)
  })
})
function userMessage(seq: number, text: string, time: number): TurnEventSlice {
  return { type: 'user/message', seq, time, data: { text } }
}

describe('TurnLog narrative (任务叙事)', () => {
  it('captures the first user message after turn/start as the narrative', () => {
    const log = new TurnLog()
    const narrated = log.append([
      turnStart(1, 1, 1000),
      userMessage(2, '修复登录超时', 1050),
      userMessage(3, '第二条不该覆盖', 1060),
      toolCall(4, 1, 'c1', 'write', '{}', 1100),
      turnEnd(5, 1, 2000),
    ])
    expect(log.turns[0]?.narrative).toBe('修复登录超时')
    expect(narrated).toEqual([1])
  })

  it('clamps whitespace and truncates over-long text', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      userMessage(2, `  多行\n\n文本   保留 单空格  ${'x'.repeat(120)}`, 1050),
    ])
    const narrative = log.turns[0]?.narrative ?? ''
    expect(narrative).not.toContain('\n')
    expect(narrative.endsWith('…')).toBe(true)
    expect(narrative.length).toBeLessThanOrEqual(81)
  })

  it('ignores user messages before any turn/start (compaction leftovers)', () => {
    const log = new TurnLog()
    const narrated = log.append([userMessage(1, '孤儿消息', 900)])
    expect(log.turns).toHaveLength(0)
    expect(narrated).toEqual([])
  })

  it('restoreNarratives fills empty slots; fresh events still win regardless of ordering', () => {
    const log = new TurnLog()
    log.append([
      turnStart(1, 1, 1000),
      turnStart(2, 2, 3000),
    ])
    log.restoreNarratives([[1, '磁盘旧值'], [2, '磁盘旧值2']])
    // 恢复先完成、事件后到:turn 2 的新鲜文本覆盖磁盘旧值(优先级契约)。
    log.append([userMessage(3, '新捕获', 3100)])
    expect(log.turns[0]?.narrative).toBe('磁盘旧值')
    expect(log.turns[1]?.narrative).toBe('新捕获')
    expect(log.narratives()).toEqual([[1, '磁盘旧值'], [2, '新捕获']])
  })
})
