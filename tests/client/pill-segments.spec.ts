/**
 * Pill 片段协议测试：文本派生 / 片段筛选与顺序 / 兜底规则 / 渲染管道。
 * 纯逻辑层（不含 DOM 挂载）：断言节点数量与摘要文本即可验证协议行为。
 */
import { describe, expect, it, vi } from 'vitest'

// react 是 dsh 平台外部模块（repo 内无该包）：mock 注册表优先于包解析，
// 覆盖 JSX 运行时与订阅钩子桩（类型仍由 @types/react 提供）。
vi.mock('react', () => ({
  Fragment: Symbol('Fragment'),
  createElement: () => ({}),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown): unknown => get(),
}))
vi.mock('react/jsx-runtime', () => ({
  jsx: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: { ...(props ?? {}), key }, key }),
  jsxs: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: { ...(props ?? {}), key }, key }),
  Fragment: Symbol('Fragment'),
}))
vi.mock('react/jsx-dev-runtime', () => ({
  jsxDEV: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: { ...(props ?? {}), key }, key }),
  jsx: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: { ...(props ?? {}), key }, key }),
  jsxs: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: { ...(props ?? {}), key }, key }),
  Fragment: Symbol('Fragment'),
}))

import {
  PILL_SEGMENTS, branchLabelText, dirtyBadgeText, enabledSegments, popupBadgeTexts,
  renderPill, syncBadgeText, type ReadyView,
} from '../../src/client/pill-segments.tsx'
import { DEFAULT_SETTINGS, patchPill, type CountsSettings, type PillSettings } from '../../src/contracts/settings.ts'
import type { GitSnapshot } from '../../src/host/types.ts'
import { zh } from '../../src/client/locales.ts'
import type { GitKey } from '../../src/client/locales.ts'

const t = (key: GitKey): string => zh[key]

/** 构造就绪视图（演示数据：dirty + 领先 + 游离可切换）。 */
function readyView(overrides: Partial<GitSnapshot> = {}): ReadyView {
  return {
    state: 'ready',
    snapshot: {
      root: '/repo',
      branch: 'main',
      head: 'a1b2c3d',
      unborn: false,
      dirty: true,
      staged: 2,
      modified: 1,
      untracked: 3,
      ahead: 1,
      behind: 2,
      lastCommit: null,
      recentCommits: [],
      changes: [],
      truncated: false,
      refreshIntervalMs: 30_000,
      checkedAt: 0,
      ...overrides,
    },
  }
}

describe('文本派生', () => {
  it('dirtyBadgeText filters sub-counts by settings', () => {
    const counts: CountsSettings = { staged: true, modified: true, untracked: false }
    expect(dirtyBadgeText(readyView().snapshot, counts)).toBe('+2 −1')
  })

  it('dirtyBadgeText omits zero counts even when enabled', () => {
    const counts: CountsSettings = { staged: true, modified: false, untracked: false }
    expect(dirtyBadgeText(readyView({ staged: 0 }).snapshot, counts)).toBe('')
  })

  it('syncBadgeText renders ahead/behind pair', () => {
    expect(syncBadgeText(readyView().snapshot)).toBe('↑1 ↓2')
    expect(syncBadgeText(readyView({ ahead: 0, behind: 0 }).snapshot)).toBe('')
  })

  it('branchLabelText handles normal / detached / unborn', () => {
    expect(branchLabelText(readyView().snapshot, t)).toBe('main')
    expect(branchLabelText(readyView({ branch: null }).snapshot, t)).toBe(`(${zh['pill.detached']}) · a1b2c3d`)
    expect(branchLabelText(readyView({ unborn: true }).snapshot, t)).toBe(`main · ${zh['pill.noCommits']}`)
  })
})

describe('enabledSegments（设置驱动筛选）', () => {
  it('standard settings enable all four segments in order', () => {
    const segments = enabledSegments(DEFAULT_SETTINGS.pill)
    expect(segments.map((s) => s.key)).toEqual(['dot', 'branch', 'counts', 'sync'])
  })

  it('minimal settings keep only dot and branch', () => {
    const minimal = enabledSegments(patchPill(DEFAULT_SETTINGS, { counts: { staged: false, modified: false, untracked: false }, sync: false }).pill)
    expect(minimal.map((s) => s.key)).toEqual(['dot', 'branch'])
  })

  it('counts segment is disabled when every sub-count is off', () => {
    const pill: PillSettings = patchPill(DEFAULT_SETTINGS, { counts: { staged: false, modified: false, untracked: false } }).pill
    expect(enabledSegments(pill).map((s) => s.key)).not.toContain('counts')
  })

  it('injects the minimal dot segment when everything is off (never an empty pill)', () => {
    const allOff: PillSettings = {
      dot: false, branch: false,
      counts: { staged: false, modified: false, untracked: false },
      sync: false, workRecord: false,
    }
    expect(enabledSegments(allOff).map((s) => s.key)).toEqual(['dot'])
  })

  it('registration table exposes one enabled hook per segment key (protocol completeness)', () => {
    expect(PILL_SEGMENTS.map((s) => s.key).sort()).toEqual(['branch', 'counts', 'dot', 'sync'])
  })
})

describe('renderPill（渲染管道）', () => {
  it('renders nodes in segment order with the combined summary', () => {
    const view = readyView()
    const render = renderPill(view, DEFAULT_SETTINGS.pill, t)
    expect(render.nodes).toHaveLength(4)
    expect(render.summary).toBe('main · +2 −1 ?3 · ↑1 ↓2')
  })

  it('reflects sub-count settings in both nodes and summary', () => {
    const pill = patchPill(DEFAULT_SETTINGS, { counts: { untracked: false } }).pill
    const render = renderPill(readyView(), pill, t)
    expect(render.summary).toBe('main · +2 −1 · ↑1 ↓2')
  })

  it('all-off falls back to the dot node only with an empty summary', () => {
    const allOff: PillSettings = {
      dot: false, branch: false,
      counts: { staged: false, modified: false, untracked: false },
      sync: false, workRecord: false,
    }
    const render = renderPill(readyView(), allOff, t)
    expect(render.nodes).toHaveLength(1)
    expect(render.summary).toBe('')
  })

  it('renders nodes as React elements (pipe-safe for both pill and preview)', () => {
    const render = renderPill(readyView(), DEFAULT_SETTINGS.pill, t)
    // 节点为 React 元素对象（可为 createElement 消费），非裸字符串/数字。
    expect(render.nodes.every((node) => node !== null && node !== undefined && typeof node === 'object')).toBe(true)
  })
})

describe('popupBadgeTexts（弹窗头部徽章沿 Pill 设置）', () => {
  it('respects counts sub-settings and the sync switch', () => {
    const view = readyView()
    expect(popupBadgeTexts(view.snapshot, DEFAULT_SETTINGS.pill)).toEqual([
      { key: 'counts', text: '+2 −1 ?3' },
      { key: 'sync', text: '↑1 ↓2' },
    ])
    const minimal = { dot: true, branch: true, counts: { staged: false, modified: false, untracked: false }, sync: false, workRecord: false } satisfies PillSettings
    expect(popupBadgeTexts(view.snapshot, minimal)).toEqual([])
  })
})
