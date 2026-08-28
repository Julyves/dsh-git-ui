// @vitest-environment jsdom
/**
 * 弹窗最近提交 → 历史页深链（popup commit deep-link）接线测试。
 *
 * 覆盖链路两端（HistoryTab 的 focusRef 哈希直达消费是既有机制，此处只锁新接线）：
 *   A. GitPopupBody —— 最近提交行整行可点击（button + __change-link），点击回调
 *      onOpenCommit(该行提交完整哈希)；设置 popup.recentCommits = 0 时区块整体
 *      不渲染（设置前提天然守卫，无行可点）。
 *   B. GitCenter —— 外部 commitRequest prop（pill 桥接通道）：
 *      B1 到达即切到 history 标签；
 *      B2 用户手动离开 history 后，同哈希新 nonce 请求（重复点击同一提交）
 *          再次切回——引用变化驱动 effect 重触发（H8 nonce 语义）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { GitPopupBody } from '../../src/client/pill/popup/GitPopupBody.tsx'
import { GitCenter } from '../../src/client/GitCenter.tsx'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import { DEFAULT_SETTINGS } from '../../src/contracts/settings.ts'
import type { GitUISettings } from '../../src/contracts/settings.ts'
import type { GitView, GitQueryOutcome } from '../../src/client/controller.ts'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitCommit, GitQueryRequest, GitSnapshot } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

/** 多轮事件循环冲刷：jsdom 下 React 并发调度按事件循环轮次推进——单次长定时
 *  等待可能先于调度任务触发（实测单等 20ms 状态未落地，逐轮 setTimeout(0) 即可）。 */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
}

const t = (key: keyof typeof zh): string => zh[key]

/** UI 基础组件桩：Modal 只在 open 时透传 children；Button 剥离契约专有 props。 */
const ui: UIPrimitives = {
  Modal: (props) => (props.open ? <div>{props.children}</div> : null),
  Button: ({ variant: _v, size: _s, icon: _i, ...rest }) => <button type="button" {...rest}>{rest.children}</button>,
  Toast: () => null,
}

const COMMIT_FIRST: GitCommit = { hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', shortHash: 'aaaa111', subject: 'feat: first', author: 'alice', dateIso: '2026-01-01T00:00:00Z' }
const COMMIT_SECOND: GitCommit = { hash: 'ffff6666777788889999aaaabbbbccccdddd0000', shortHash: 'ffff666', subject: 'fix: second', author: 'bob', dateIso: '2026-01-02T00:00:00Z' }
const COMMITS: readonly GitCommit[] = [COMMIT_FIRST, COMMIT_SECOND]

const SNAPSHOT: GitSnapshot = {
  root: '~/projects/demo-repo', branch: 'main', head: 'aaaa111', unborn: false,
  dirty: true, staged: 2, modified: 1, untracked: 3, ahead: 1, behind: 2,
  lastCommit: null, recentCommits: COMMITS, changes: [], truncated: false,
  refreshIntervalMs: 30_000, watchVersion: 0, checkedAt: 0,
}

const VIEW: GitView & { state: 'ready' } = { state: 'ready', snapshot: SNAPSHOT }

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })
/** branches 供给弹窗分支切换器装载；其余查询失败态均有守卫（HistoryTab 错误路径）。 */
const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
  if (q.kind === 'branches') {
    return { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [], remote: [] } }
  }
  return { ok: false, message: 'stub' }
}

async function renderPopup(settings: GitUISettings, onOpenCommit: (hash: string) => void = () => {}): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(
    <UIPrimitivesProvider value={ui}>
      <GitPopupBody
        view={VIEW} settings={settings} refresh={async () => {}}
        openCenter={() => {}} openRecords={() => {}} openSettings={() => {}}
        onOpenDiff={() => {}} onOpenCommit={onOpenCommit} records={null} onReclassify={() => {}}
        run={run} query={query} t={t}
      />
    </UIPrimitivesProvider>,
  )
  await flush()
  return { container, root }
}

describe('GitPopupBody — 最近提交行深链（A）', () => {
  it('A1: 提交行整行渲染为 button（__row + __change-link 可点击语义）', async () => {
    const { container, root } = await renderPopup(DEFAULT_SETTINGS)
    for (const c of COMMITS) {
      const row = container.querySelector(`button[title*="${c.shortHash}"]`)
      expect(row).not.toBeNull()
      expect(row?.className).toContain('dsh-git-ui__row')
      expect(row?.className).toContain('dsh-git-ui__change-link')
      // title 提示深链动作文案（可发现性）
      expect(row?.getAttribute('title')).toContain(t('popup.openCommit'))
    }
    root.unmount()
  })
  it('A2: 点击第二行 → onOpenCommit 收到该行完整哈希', async () => {
    const onOpenCommit = vi.fn()
    const { container, root } = await renderPopup(DEFAULT_SETTINGS, onOpenCommit)
    const second = container.querySelector(`button[title*="${COMMIT_SECOND.shortHash}"]`) as HTMLButtonElement
    second.click()
    expect(onOpenCommit).toHaveBeenCalledTimes(1)
    expect(onOpenCommit).toHaveBeenCalledWith(COMMIT_SECOND.hash)
    root.unmount()
  })

  it('A3: 设置 recentCommits = 0 → 区块不渲染，无行可点（设置前提守卫）', async () => {
    const settings: GitUISettings = { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, recentCommits: 0 } }
    const { container, root } = await renderPopup(settings)
    for (const c of COMMITS) {
      expect(container.querySelector(`button[title*="${c.shortHash}"]`)).toBeNull()
    }
    root.unmount()
  })
})

describe('GitCenter — 外部 commitRequest 深链接线（B）', () => {
  async function renderCenter(commitRequest: { hash: string; nonce: number } | null): Promise<{ container: HTMLElement; root: Root }> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <UIPrimitivesProvider value={ui}>
        <GitCenter
          open onClose={() => {}} initialTab="changes" snapshot={SNAPSHOT}
          commitRequest={commitRequest} run={run} query={query} t={t}
        />
      </UIPrimitivesProvider>,
    )
    await flush()
    return { container, root }
  }

  const activeTab = (container: HTMLElement): string | null =>
    container.querySelector('.dsh-git-ui__tab--active')?.getAttribute('id') ?? null

  it('B1: commitRequest 到达 → history 标签激活（外部深链切标签）', async () => {
    const { container, root } = await renderCenter({ hash: COMMIT_FIRST.hash, nonce: 1 })
    expect(activeTab(container)).toBe('dsh-git-ui-tab-history')
    root.unmount()
  })

  it('B2: 手动切走后同哈希新 nonce 请求 → 再次切回 history（H8 重触发）', async () => {
    const { container, root } = await renderCenter({ hash: COMMIT_FIRST.hash, nonce: 1 })
    expect(activeTab(container)).toBe('dsh-git-ui-tab-history')
    // 用户手动切到 changes
    ;(container.querySelector('#dsh-git-ui-tab-changes') as HTMLButtonElement).click()
    await flush()
    expect(activeTab(container)).toBe('dsh-git-ui-tab-changes')
    // 同哈希重复点击：新 nonce → 新引用 → effect 重触发
    root.render(
      <UIPrimitivesProvider value={ui}>
        <GitCenter
          open onClose={() => {}} initialTab="changes" snapshot={SNAPSHOT}
          commitRequest={{ hash: COMMIT_FIRST.hash, nonce: 2 }} run={run} query={query} t={t}
        />
      </UIPrimitivesProvider>,
    )
    await flush()
    expect(activeTab(container)).toBe('dsh-git-ui-tab-history')
    root.unmount()
  })

  it('B3: 无 commitRequest → 显式 initialTab 不受影响（仍停在 changes）', async () => {
    const { container, root } = await renderCenter(null)
    expect(activeTab(container)).toBe('dsh-git-ui-tab-changes')
    root.unmount()
  })
})

describe('GitCenter — Tab 顺序与默认页', () => {
  it('缺省 initialTab → 默认落在 history（历史为第一项）', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <UIPrimitivesProvider value={ui}>
        <GitCenter open onClose={() => {}} snapshot={SNAPSHOT} run={run} query={query} t={t} />
      </UIPrimitivesProvider>,
    )
    await flush()
    expect(container.querySelector('.dsh-git-ui__tab--active')?.getAttribute('id')).toBe('dsh-git-ui-tab-history')
    root.unmount()
  })

  it('DOM 顺序：history 在 changes 之前（历史第一项、变更第二项）', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <UIPrimitivesProvider value={ui}>
        <GitCenter open onClose={() => {}} snapshot={SNAPSHOT} run={run} query={query} t={t} />
      </UIPrimitivesProvider>,
    )
    await flush()
    const ids = [...container.querySelectorAll('.dsh-git-ui__tab')].map((b) => b.id)
    expect(ids.indexOf('dsh-git-ui-tab-history')).toBeLessThan(ids.indexOf('dsh-git-ui-tab-changes'))
    expect(ids[0]).toBe('dsh-git-ui-tab-history')
    root.unmount()
  })
})
