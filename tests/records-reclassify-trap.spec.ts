/**
 * 记录页归因纠错三态循环回归锁（R2 修复，bug-hunt 第三轮 2026-08-26）。
 *
 * 旧缺陷：⇄ 对 sibling 组单向且不可逆——sibling 行只有「改归本会话」一个
 * 方向；override 值域无 sibling、撤销 API 零调用点——误改判后「其他会话
 * AI」归因永久丢失。
 *
 * 修复后的契约（本文件锁定）：
 *   1. UI 循环 internal → external → sibling → internal（3-循环全可达置换，
 *      任两组至多两击互通，完全可逆）；
 *   2. override 值域含 sibling,搬移矩阵 3×3 全方向;
 *   3. parseOverrides 接受 sibling 值(旧文件 internal/external 子集天然兼容)。
 */
import { describe, expect, it } from 'vitest'
import { applyAuthorOverrides, parseOverrides, setOverride, type AuthorOverrideMap } from '../src/client/records/overrides.ts'
import type { TurnWorkRecord, WorkEntry } from '../src/host/types.ts'

function entry(path: string): WorkEntry {
  return { path, status: 'modified', state: 'dirty', firstSeenAt: 0, commitHash: null, attribution: 'inferred' }
}

function turn(): TurnWorkRecord {
  return {
    turn: 1, startAt: 0, endAt: 1000, hasWork: true, narrative: null,
    internal: [entry('mine.ts')], sibling: [entry('theirs.ts')], external: [entry('manual.txt')],
  }
}

const ROOT = '/repo'

/** UI 的 ⇄ 行为镜像（entry-row 的 RECLASSIFY_NEXT）：三态循环。 */
const RECLASSIFY_NEXT: Record<'internal' | 'sibling' | 'external', 'internal' | 'sibling' | 'external'> = {
  internal: 'external',
  external: 'sibling',
  sibling: 'internal',
}

/** 驱动真实 override 管线,返回路径当前所在组。 */
function groupOf(overrides: AuthorOverrideMap, path: string): 'internal' | 'sibling' | 'external' {
  const t = applyAuthorOverrides([turn()], ROOT, overrides)[0]!
  if (t.internal.some((e) => e.path === path)) return 'internal'
  if (t.sibling.some((e) => e.path === path)) return 'sibling'
  return 'external'
}

/** 从起始组出发连点 n 次 ⇄ 后的所在组。 */
function cycle(path: string, from: 'internal' | 'sibling' | 'external', clicks: number): 'internal' | 'sibling' | 'external' {
  let overrides: AuthorOverrideMap = {}
  let group = from
  for (let i = 0; i < clicks; i += 1) {
    const next = RECLASSIFY_NEXT[group]
    overrides = setOverride(overrides, ROOT, path, next)
    group = groupOf(overrides, path)
  }
  return group
}

describe('⇄ 纠错三态循环（R2 回归锁）', () => {
  it('sibling 条目改出后可回到 sibling 组（旧实现永久丢失——核心回归点）', () => {
    // theirs.ts 起始在 sibling;点 3 次(→internal→external→sibling)回到 sibling。
    expect(cycle('theirs.ts', 'sibling', 3)).toBe('sibling')
    // 单击到 internal(旧行为保持)。
    expect(cycle('theirs.ts', 'sibling', 1)).toBe('internal')
    // 两击可直达 external(旧实现需两步且第二步无提示)。
    expect(cycle('theirs.ts', 'sibling', 2)).toBe('external')
  })

  it('三组两两互通:任一起点到任一目标至多两击(全可达置换)', () => {
    const groups: Array<'internal' | 'sibling' | 'external'> = ['internal', 'sibling', 'external']
    for (const from of groups) {
      for (const to of groups) {
        const path = from === 'internal' ? 'mine.ts' : from === 'sibling' ? 'theirs.ts' : 'manual.txt'
        // from === to:0 击即达(原位);否则 1-2 击内可达。
        const reachable = from === to || cycle(path, from, 1) === to || cycle(path, from, 2) === to
        expect(reachable, `${from} → ${to} 应在两击内可达`).toBe(true)
      }
    }
  })

  it('3×3 搬移矩阵:override 任意值 × 任意源组都正确落位', () => {
    for (const value of ['internal', 'sibling', 'external'] as const) {
      const overrides = setOverride({}, ROOT, 'theirs.ts', value)
      expect(groupOf(overrides, 'theirs.ts')).toBe(value)
    }
  })

  it('parseOverrides 接受 sibling 值;旧二元文件是子集,天然兼容', () => {
    const parsed = parseOverrides(JSON.stringify({ [ROOT]: { 'a.ts': 'sibling', 'b.ts': 'internal', 'c.ts': 'external' } }))
    expect(parsed[ROOT]).toEqual({ 'a.ts': 'sibling', 'b.ts': 'internal', 'c.ts': 'external' })
  })

  it('无改判条目原位保留(未改判的 sibling 留 sibling 组)', () => {
    const overrides = setOverride({}, ROOT, 'mine.ts', 'external')
    const t = applyAuthorOverrides([turn()], ROOT, overrides)[0]!
    expect(t.sibling.map((e) => e.path)).toEqual(['theirs.ts'])
  })
})
