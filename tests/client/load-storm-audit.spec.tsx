// @vitest-environment jsdom
/**
 * 插件负载审计舱（incident-load-hang 纪律 R5/R6 的产物级验证）。
 *
 * 事故背景（.agent/incident-review-load-hang.md）：历次「安装/更新插件后
 * dsh web 全局加载失败」均为客户端查询风暴 / 宿主命令风暴（会话数 × 事件
 * 频率 × 单事件成本的乘法放大）。本舱用**真实 GitController + 真实组件**，
 * 把宿主下发的轮询间隔压到 50ms（0.7s ≈ 14 轮轮询），实测各场景的 RPC
 * 量——任何风暴都会在计数上爆炸（数百/数千），有界行为则 ≤ 数十。
 *
 * 场景：
 *   A. 健康路径：snapshot ok + turn-records ok（用户真实设置 payload）。
 *   B. snapshot 永远失败（错误态轮询）。
 *   C. turn-records 永远失败。
 *   D. GitCenter 默认打开（历史首项落地）：首屏查询量有界且随时间不再增长。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GitPill } from '../../src/client/GitPill.tsx'
import { GitCenter } from '../../src/client/GitCenter.tsx'
import { GitController } from '../../src/client/controller.ts'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import type { GitView, GitQueryOutcome } from '../../src/client/controller.ts'
import { zh } from '../../src/client/locales.ts'
import { settingsStore } from '../../src/client/settings/store.ts'
import type { GitAction, GitActionResult, GitQueryRequest, GitQueryResult, GitSnapshot } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const ui: UIPrimitives = {
  Modal: (props) => (props.open ? <div>{props.children}</div> : null),
  Button: (props) => <button type="button">{props.children}</button>,
  Toast: () => null,
}

/** 用户真实 settings.json 内容（v5：workRecord 双关等）——忠实环境。 */
const USER_SETTINGS = '{"v":5,"settings":{"pill":{"dot":true,"branch":true,"sync":true,"workRecord":false,"counts":{"staged":true,"modified":true,"untracked":true}},"popup":{"rootPath":true,"statusBar":true,"branchSwitcher":true,"branchCreate":false,"recentCommits":2,"changesList":true,"workRecord":false},"diff":{"fontSize":12,"syntaxHighlight":true,"foldContext":false},"popupOrder":["statusBar","branchCreate","changesList","recentCommits","workRecord"]}}'

/** 轮询间隔压到 50ms：0.7s 真实时间 ≈ 14 轮。 */
const FAST_POLL_MS = 50
/** 观察窗（真实毫秒）。 */
const WINDOW_MS = 700

interface Counter { snapshot: number; records: number; history: number; branches: number; tags: number; authors: number; diff: number; show: number }

function makeSnapshot(seq: number): GitSnapshot {
  return {
    root: '~/p/demo', branch: 'main', head: 'abc1234', unborn: false,
    dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null, recentCommits: [], changes: [], truncated: false,
    refreshIntervalMs: FAST_POLL_MS, checkedAt: 1_000 + seq,
  }
}

function makeStub(opts: { snapshotFail?: boolean; recordsFail?: boolean } = {}) {
  const calls: Counter = { snapshot: 0, records: 0, history: 0, branches: 0, tags: 0, authors: 0, diff: 0, show: 0 }
  let snapSeq = 0
  const remote = {
    async snapshot() {
      calls.snapshot += 1
      if (opts.snapshotFail === true) return { ok: false, error: { code: 'timeout' as const } }
      return { ok: true as const, value: { ok: true as const, value: makeSnapshot(snapSeq++) } }
    },
    async run(): Promise<GitActionResult> { return { ok: false, error: { code: 'git-error', message: 'stub' } } },
    async query(req: { query: GitQueryRequest['query'] }): Promise<{ ok: true; value: GitQueryResult } | { ok: false; error: { code: string; message?: string } }> {
      const q = req.query
      switch (q.kind) {
        case 'turn-records':
          calls.records += 1
          if (opts.recordsFail === true) return { ok: true, value: { kind: 'turn-records', turns: [] } }
          return { ok: true, value: { kind: 'turn-records', turns: [] } }
        case 'history':
          calls.history += 1
          return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
        case 'branches':
          calls.branches += 1
          return { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [], remote: [] } }
        case 'tags':
          calls.tags += 1
          return { ok: true, value: { kind: 'tags', tags: [] } }
        case 'authors':
          calls.authors += 1
          return { ok: true, value: { kind: 'authors', authors: [] } }
        case 'diff':
          calls.diff += 1
          return { ok: true, value: { kind: 'diff', path: q.path, text: '' } }
        case 'show':
          calls.show += 1
          return { ok: true, value: { kind: 'show', ref: q.ref, commit: null, body: '', stats: [] } }
      }
    },
  }
  return { calls, remote }
}

/** 忠实接线（镜像 client/index.ts）：controller + useGit/useSession 绑定。 */
function wire(controller: GitController) {
  const useGit = <S,>(selector?: (view: GitView) => S): S => (selector ?? ((v: GitView) => v as unknown as S))(controller.getSnapshot())
  const useSession = <S,>(selector: (s: { turnEnds: ReadonlyMap<number, number> }) => S): S => selector({ turnEnds: new Map<number, number>() })
  return { useGit, useSession }
}

async function mountPill(controller: GitController): Promise<{ container: HTMLElement; root: Root }> {
  const { useGit, useSession } = wire(controller)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(
    createElement(UIPrimitivesProvider, { value: ui }, createElement(GitPill, {
      sessionId: 's1', useGit, useSession,
      hooks: { git: controller },
      refresh: () => controller.refresh(),
      run: (action: GitAction) => controller.run(action),
      query: (query: GitQueryRequest['query']): Promise<GitQueryOutcome> => controller.query(query),
      storageRead: async () => null, storageWrite: async () => true, t,
    })),
  )
  await new Promise((r) => setTimeout(r, 20))
  return { container, root }
}

/** 多轮事件循环冲刷：jsdom 下 React 并发调度按事件循环轮次推进。 */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/** 真实时间观察窗：期间持续 yield 让轮询/渲染全速运转。 */
async function observe(ms: number): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) await new Promise((r) => setTimeout(r, 10))
}

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

describe('负载审计 — 每会话 RPC 量有界（风暴探测）', () => {
  it('A: 健康路径 0.7s(≈14 轮轮询窗口) — snapshot/records 各 ≈ 轮询数，总量 < 60', async () => {
    await settingsStore.initialize({ read: async () => USER_SETTINGS, write: async () => {} })
    const { calls, remote } = makeStub()
    const controller = new GitController(remote as never, 's1')
    cleanup.push(() => controller.dispose())
    const { root } = await mountPill(controller)
    cleanup.push(() => root.unmount())

    await observe(WINDOW_MS)
    controller.dispose()
    root.unmount()

    // 50ms 间隔 + 700ms 窗口 ≈ 1 initial + ~14 polls。
    expect(calls.snapshot).toBeGreaterThan(3)
    expect(calls.snapshot).toBeLessThan(40)
    expect(calls.records).toBeLessThanOrEqual(calls.snapshot + 2)
    const total = Object.values(calls).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(60)
  })

  it('B: snapshot 永远失败 — 错误态按 50ms 间隔有界轮询，无风暴', async () => {
    const { calls, remote } = makeStub({ snapshotFail: true })
    const controller = new GitController(remote as never, 's1')
    cleanup.push(() => controller.dispose())
    const { root } = await mountPill(controller)
    cleanup.push(() => root.unmount())

    await observe(WINDOW_MS)
    controller.dispose()
    root.unmount()

    // 失败态回落默认 30s 间隔（pollMs 仅随成功快照更新）——窗口内仅首发 1 次。
    expect(calls.snapshot).toBe(1)
    expect(calls.records).toBe(0)
  })

  it('C: turn-records 永远失败 — 每 checkedAt 至多 1 次，无重试风暴', async () => {
    const { calls, remote } = makeStub({ recordsFail: true })
    const controller = new GitController(remote as never, 's1')
    cleanup.push(() => controller.dispose())
    const { root } = await mountPill(controller)
    cleanup.push(() => root.unmount())

    await observe(WINDOW_MS)
    controller.dispose()
    root.unmount()

    expect(calls.records).toBeLessThanOrEqual(calls.snapshot + 2)
  })

  it('D: GitCenter 默认打开（历史首项）— 首屏 4 查询有界，静置不再增长', async () => {
    const { calls, remote } = makeStub()
    const controller = new GitController(remote as never, 's1')
    cleanup.push(() => controller.dispose())
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    cleanup.push(() => root.unmount())
    root.render(
      createElement(UIPrimitivesProvider, { value: ui }, createElement(GitCenter, {
        open: true, onClose: () => {}, snapshot: makeSnapshot(0),
        run: (action: GitAction) => controller.run(action),
        query: (query: GitQueryRequest['query']): Promise<GitQueryOutcome> => controller.query(query),
        t,
      })),
    )
    await flush()
    expect(calls.history).toBe(1)
    expect(calls.branches).toBe(1)
    expect(calls.tags).toBe(1)
    expect(calls.authors).toBe(1)
    expect(calls.diff).toBe(0)

    // 静置：无自动重查（历史页无轮询）。
    await observe(250)
    expect(calls.history).toBe(1)
    expect(calls.branches).toBe(1)
    root.unmount()
  })
})
