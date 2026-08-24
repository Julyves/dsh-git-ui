import { describe, expect, it } from 'vitest'
import { sliceEvents, type SessionLike } from '../src/adapters/dsh/session-log.ts'
import { collectSubagentWrites } from '../src/adapters/dsh/subagent-adapter.ts'

/** 构造一个 dsh 形状的会话(#结构化切片)。 */
function session(seq: number, events: Array<{ type: string; time: number; data?: Record<string, unknown> }>): SessionLike {
  const log = events.map((event, index) => ({
    type: event.type,
    seq: index + 1,
    time: event.time,
    data: event.data ?? {},
  }))
  return { events: log, seq }
}

describe('sliceEvents', () => {
  it('maps turn/tool events and strips unknown fields', () => {
    const s = session(4, [
      { type: 'turn/start', time: 1000, data: { turn: 1, extra: 'x' } },
      { type: 'tool/call', time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a"}' } },
      { type: 'tool/result', time: 1200, data: { turn: 1, meta: { diffs: [{ path: 'a' }] }, message: { toolCallId: 'c1' } } },
      { type: 'assistant/message', time: 1300, data: { turn: 1 } },
    ])
    expect(sliceEvents(s)).toEqual([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a"}' } },
      { type: 'tool/result', seq: 3, time: 1200, data: { turn: 1, callId: 'c1', meta: { diffs: [{ path: 'a' }] } } },
    ])
  })

  it('drops malformed tool events (missing fields)', () => {
    const s = session(2, [
      { type: 'tool/call', time: 1000, data: { turn: 1, name: 'x' } }, // 缺 arguments/callId
      { type: 'tool/result', time: 1100, data: { meta: 1 } }, // 缺 turn
    ])
    expect(sliceEvents(s)).toEqual([])
  })

  it('maps session/end-seed so seed filtering can find it', () => {
    const s = session(3, [
      { type: 'session/end-seed', time: 1000 },
      { type: 'turn/start', time: 1100, data: { turn: 1 } },
    ])
    expect(sliceEvents(s).map((e) => e.type)).toEqual(['session/end-seed', 'turn/start'])
  })

  it('returns [] for an unknown session', () => {
    expect(sliceEvents(undefined)).toEqual([])
  })
})

describe('collectSubagentWrites', () => {
  const presenter = { presentCall: (name: string, args: unknown) => {
    const record = args as { file_path?: unknown }
    return typeof record.file_path === 'string' ? { card: 'diff', diffs: [{ path: record.file_path }] } : undefined
  } }

  it('attributes child writes after the seed boundary to the parent turn', () => {
    const child = session(7, [
      // seed = 父日志(归父,应跳过)
      { type: 'session/end-seed', time: 1000 },
      { type: 'turn/start', time: 1500, data: { turn: 1 } },
      { type: 'tool/call', time: 1600, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"sub/out.ts"}' } },
    ])
    const sessions = {
      get: (id: string): SessionLike | undefined => id === 'child-1' ? child : undefined,
      list: () => [{ id: 'child-1', header: { meta: { origin: 'subagent', parentSession: 'parent' } } }],
    }
    const parentTurns = [{ turn: 2, startAt: 1400, endAt: 2000 }]
    const result = collectSubagentWrites('parent', parentTurns, sessions, '/repo', presenter)
    expect(result.get(2)).toEqual([{ path: 'sub/out.ts', authoritative: true }])
  })

  it('rejects child calls outside any parent turn window', () => {
    const child = session(4, [
      { type: 'session/end-seed', time: 1000 },
      { type: 'tool/call', time: 3000, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"x.ts"}' } },
    ])
    const sessions = {
      get: () => child,
      list: () => [{ id: 'c', header: { meta: { origin: 'subagent', parentSession: 'parent' } } }],
    }
    const parentTurns = [{ turn: 1, startAt: 1000, endAt: 2000 }] // 子调用发生在窗口外
    expect(collectSubagentWrites('parent', parentTurns, sessions, '/repo', presenter).size).toBe(0)
  })

  it('ignores cold children and missing subagents service', () => {
    const sessionsCold = {
      get: () => undefined, // 冷子会话
      list: () => [{ id: 'c', header: { meta: { origin: 'subagent', parentSession: 'parent' } } }],
    }
    expect(collectSubagentWrites('parent', [{ turn: 1, startAt: 0, endAt: null }], sessionsCold, '/repo', presenter).size).toBe(0)
    expect(collectSubagentWrites('parent', [{ turn: 1, startAt: 0, endAt: null }], undefined, '/repo', presenter).size).toBe(0)
  })

  it('never folds seed (parent) tool calls into the child work', () => {
    const child = session(6, [
      { type: 'turn/start', time: 500, data: { turn: 1 } },
      { type: 'tool/call', time: 600, data: { turn: 1, callId: 'p1', name: 'write', arguments: '{"file_path":"parent-seed.ts"}' } },
      { type: 'session/end-seed', time: 1000 },
      { type: 'turn/start', time: 1500, data: { turn: 2 } },
      { type: 'tool/call', time: 1600, data: { turn: 2, callId: 'c1', name: 'write', arguments: '{"file_path":"child.ts"}' } },
    ])
    const sessions = {
      get: () => child,
      list: () => [{ id: 'c', header: { meta: { origin: 'subagent', parentSession: 'parent' } } }],
    }
    const result = collectSubagentWrites('parent', [{ turn: 1, startAt: 1200, endAt: 2000 }], sessions, '/repo', presenter)
    const paths = (result.get(1) ?? []).map((detail) => detail.path)
    expect(paths).toContain('child.ts')
    expect(paths).not.toContain('parent-seed.ts')
  })
})