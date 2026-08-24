/**
 * 归因人工纠错(overrides)单元测试:解析容错、不可更更新、三组间搬移。
 */
import { describe, expect, it } from 'vitest'
import { applyAuthorOverrides, mergeOverrides, parseOverrides, serializeOverrides, setOverride } from '../../src/client/records/overrides.ts'
import type { TurnWorkRecord } from '../../src/host/types.ts'

const entry = (path: string) => ({ path, status: 'modified' as const, state: 'dirty' as const, firstSeenAt: 1, commitHash: null, attribution: 'authoritative' as const })
const turn: TurnWorkRecord = {
  turn: 1, startAt: 0, endAt: 100, hasWork: true, narrative: null,
  internal: [entry('ai.ts')], sibling: [entry('sib.ts')], external: [entry('mine.ts')],
}

describe('parseOverrides / serializeOverrides', () => {
  it('round-trips a valid map; corrupt input degrades to empty', () => {
    const map = { '/repo': { 'a.ts': 'internal' as const } }
    expect(parseOverrides(serializeOverrides(map))).toEqual(map)
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides('not json')).toEqual({})
    // 非法改判值被剔除(保留空桶,根级结构不变)。
    expect(parseOverrides(JSON.stringify({ '/repo': { 'a.ts': 'bogus' } }))).toEqual({ '/repo': {} })
  })
})

describe('setOverride (不可变更新)', () => {
  it('adds and removes without mutating the original', () => {
    const base = { '/repo': {} }
    const next = setOverride(base, '/repo', 'a.ts', 'internal')
    expect(next['/repo']?.['a.ts']).toBe('internal')
    expect(base['/repo']).toEqual({})
    expect(setOverride(next, '/repo', 'a.ts', null)['/repo']?.['a.ts']).toBeUndefined()
  })
})

describe('applyAuthorOverrides (展示层搬移)', () => {
  it('moves overridden paths between groups per turn', () => {
    const overrides = { '/repo': { 'mine.ts': 'internal' as const, 'ai.ts': 'external' as const } }
    const out = applyAuthorOverrides([turn], '/repo', overrides)[0]!
    expect(out.internal.map((e) => e.path)).toEqual(['mine.ts'])
    expect(out.sibling.map((e) => e.path)).toEqual(['sib.ts'])
    expect(out.external.map((e) => e.path)).toEqual(['ai.ts'])
  })

  it('sibling entries obey the external direction', () => {
    const overrides = { '/repo': { 'sib.ts': 'external' as const } }
    const out = applyAuthorOverrides([turn], '/repo', overrides)[0]!
    expect(out.sibling).toHaveLength(0)
    expect(out.external.map((e) => e.path)).toContain('sib.ts')
  })

  it('returns the same reference when no overrides exist for the root', () => {
    const records = [turn]
    expect(applyAuthorOverrides(records, '/other', {})).toBe(records)
    expect(applyAuthorOverrides(records, '/repo', { '/repo': {} })).toBe(records)
  })
})

describe('applyAuthorOverrides — sibling 方向修复(P1-1 回归)', () => {
  it('sibling + override internal → 搬入 internal 组(旧实现静默无效)', () => {
    const overrides = { '/repo': { 'sib.ts': 'internal' as const } }
    const out = applyAuthorOverrides([turn], '/repo', overrides)[0]!
    expect(out.internal.map((e) => e.path)).toContain('sib.ts')
    expect(out.sibling).toHaveLength(0)
  })

  it('override 为目标组自身时无操作(改判回原组 = 撤销,效果等价)', () => {
    const overrides = { '/repo': { 'ai.ts': 'internal' as const, 'mine.ts': 'external' as const } }
    const out = applyAuthorOverrides([turn], '/repo', overrides)[0]!
    expect(out.internal.map((e) => e.path)).toContain('ai.ts')
    expect(out.external.map((e) => e.path)).toContain('mine.ts')
  })
})

describe('mergeOverrides (写前合并,P2-5)', () => {
  it('并集合并;键冲突取 mine(本实例最新意图)', () => {
    const mine = { '/repo': { 'a.ts': 'internal' as const } }
    const theirs = { '/repo': { 'a.ts': 'external' as const, 'b.ts': 'external' as const }, '/other': { 'c.ts': 'internal' as const } }
    const merged = mergeOverrides(mine, theirs)
    expect(merged['/repo']?.['a.ts']).toBe('internal')
    expect(merged['/repo']?.['b.ts']).toBe('external')
    expect(merged['/other']?.['c.ts']).toBe('internal')
  })

  it('空侧合并保持另一侧原样', () => {
    const map = { '/repo': { 'a.ts': 'internal' as const } }
    expect(mergeOverrides(map, {})).toEqual(map)
    expect(mergeOverrides({}, map)).toEqual(map)
  })
})
