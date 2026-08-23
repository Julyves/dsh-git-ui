/**
 * 临时性能/安全基准(事故排查用;排查后删除)。
 * 极端输入下测量 host 管线各环节耗时与是否有同步死循环/长任务。
 */
import { describe, expect, it } from 'vitest'
import { TurnLog, type TurnEventSlice } from '../src/host/turns.ts'
import { bashWriteTargets, tokenizeShell, extractWritePaths, normalizeRepoPath } from '../src/host/write-paths.ts'
import { encodeObservations, decodeObservations } from '../src/host/obs-file.ts'
import { ObservationLog } from '../src/host/observation.ts'
import { assembleAll } from '../src/host/record-assembly.ts'
import type { GitChange } from '../src/host/types.ts'

function measure(label: string, fn: () => void): number {
  const start = performance.now()
  fn()
  const ms = performance.now() - start
  // eslint-disable-next-line no-console
  console.log(`[bench] ${label}: ${ms.toFixed(1)}ms`)
  return ms
}

describe('host pipeline extreme-input audit', () => {
  it('folds a huge log (1000 turns x 100 calls) without pathology', () => {
    const events: TurnEventSlice[] = []
    for (let turn = 1; turn <= 1000; turn += 1) {
      events.push({ type: 'turn/start', seq: events.length + 1, time: turn * 1000, data: { turn } })
      for (let call = 0; call < 100; call += 1) {
        events.push({ type: 'tool/call', seq: events.length + 1, time: turn * 1000 + call, data: { turn, callId: `c${turn}-${call}`, name: 'write', arguments: '{"file_path":"f.ts"}' } })
        events.push({ type: 'tool/result', seq: events.length + 1, time: turn * 1000 + call + 1, data: { turn, callId: `c${turn}-${call}`, meta: { diffs: [{ path: 'f.ts' }] } } })
      }
      events.push({ type: 'turn/end', seq: events.length + 1, time: turn * 1000 + 200, data: { turn } })
    }
    const log = new TurnLog()
    const first = measure('fold 110k events', () => log.append(events))
    expect(log.turns.length).toBe(1000)
    // 增量幂等
    const second = measure('re-fold same events (no-op)', () => log.append(events))
    expect(log.foldedUpToSeq).toBe(events.length + 1)
    // 极端规模下不得出现秒级长任务(宿主事件循环被占 = 全站加载卡死的先例)
    expect(first).toBeLessThan(2000)
    expect(second).toBeLessThan(100)
  })

  it('assembles records over a huge log + full observation log quickly', () => {
    const log = new TurnLog()
    const events: TurnEventSlice[] = []
    for (let turn = 1; turn <= 200; turn += 1) {
      events.push({ type: 'turn/start', seq: events.length + 1, time: turn * 1000, data: { turn } })
      for (let call = 0; call < 20; call += 1) {
        events.push({ type: 'tool/call', seq: events.length + 1, time: turn * 1000 + call, data: { turn, callId: `c${turn}-${call}`, name: 'write', arguments: `{"file_path":"dir/f${call}.ts"}` } })
      }
      events.push({ type: 'turn/end', seq: events.length + 1, time: turn * 1000 + 200, data: { turn } })
    }
    log.append(events)
    const observations = new ObservationLog()
    const changes: GitChange[] = []
    for (let i = 0; i < 2000; i += 1) {
      changes.push({ path: `dir/f${i}.ts`, status: 'modified', staged: false, isDirectory: false })
    }
    observations.update(changes, 500)
    const ms = measure('assemble 200 turns x 2000 obs', () => {
      const records = assembleAll({
        log, observations, changes, repoRoot: '/repo',
        presenter: undefined, mtimes: undefined, now: 1_000_000, subagentWrites: new Map(),
      })
      expect(records.length).toBe(200)
    })
    expect(ms).toBeLessThan(2000)
  })

  it('tokenizer / bash heuristic handle pathological inputs linearly', () => {
    const nasty = 'a'.repeat(500_000) + ' > ' + 'b'.repeat(500_000) + '; ' + '"'.repeat(100_000)
    const ms = measure('tokenize 1.1MB pathological input', () => {
      const tokens = tokenizeShell(nasty)
      expect(tokens.length).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(2000)
    const ms2 = measure('bashWriteTargets 1MB', () => expect(bashWriteTargets(nasty, undefined, '/repo')).toBeDefined())
    expect(ms2).toBeLessThan(2000)
  })

  it('extractWritePaths tolerates adversarial args JSON', () => {
    const deep = '{"a":' + '['.repeat(100_000) + ''.repeat(0) + ']'.repeat(100_000) + '}'
    const ms = measure('extractWritePaths 100k-deep JSON', () => {
      expect(extractWritePaths('write', deep, '/repo', undefined)).toEqual([])
    })
    // JSON.parse 对超深数组在 Node 中有限制,只要求不挂死/不 OOM
    expect(ms).toBeLessThan(2000)
  })

  it('normalizeRepoPath handles long/weird paths', () => {
    // 大量 `..` 逃逸出根 → null;线性处理,不得卡顿。
    const escaping = '../'.repeat(50_000) + 'b.ts'
    const ms = measure('normalize 50k-dotdot', () => expect(normalizeRepoPath(escaping, '/repo')).toBeNull())
    expect(ms).toBeLessThan(1000)
    // 大量合法段 → 正常折叠,不得抛错。
    const long = 'a/'.repeat(50_000) + 'b.ts'
    const ms2 = measure('normalize 50k segments', () => {
      const result = normalizeRepoPath(long, '/repo')
      expect(result?.endsWith('b.ts')).toBe(true)
    })
    expect(ms2).toBeLessThan(1000)
  })

  it('observation cap + encode round-trip stays bounded', () => {
    const observations = new ObservationLog()
    const changes: GitChange[] = []
    for (let i = 0; i < 10_000; i += 1) {
      changes.push({ path: `f${i}.ts`, status: 'modified', staged: false, isDirectory: false })
    }
    observations.update(changes, 1000)
    expect(observations.entries().length).toBeLessThanOrEqual(2000)
    const ms = measure('encode 2000 obs', () => {
      const raw = encodeObservations(observations.serialize())
      expect(decodeObservations(raw)?.length).toBe(2000)
    })
    expect(ms).toBeLessThan(1000)
  })
})