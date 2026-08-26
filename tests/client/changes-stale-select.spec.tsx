// @vitest-environment jsdom
/**
 * ChangesTab 缺陷复现（bug-hunt 第二轮 2026-08-26，fix/bug-hunt 分支）。
 *
 * C-A（高）：`selected` 选择集从不随快照修剪——被 agent 恢复/删除的文件路径
 *   永久残留；行已消失无法反选，commit 把失效路径发给 host → `git add` 128
 *   → 整个提交序列中止。真实 git 已验证（见 docs/changes-bug-hunt.md）。
 * C-B（中）：diff 查询失败被吞——diffText=null 与「无差异」共用空态，实际
 *   文案是「无文件变更」，对选中文件更具误导性。
 * C-C（中）：快照驱动的 reconcile effect 对每次轮询快照一律重取 diff——
 *   内容未变也闪 loading（DiffSideBySide 卸载 → 滚动位置丢失）。
 *
 * it.fails 三项：当前实现按失败预期；修复后翻红提示移除 .fails（C-B 为
 * confirming 断言，修复后应反转为错误文案断言）。
 */
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import { ChangesTab } from '../../src/client/center/changes/ChangesTab.tsx'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitQueryRequest, GitSnapshot } from '../../src/host/types.ts'
import type { GitQueryOutcome } from '../../src/client/controller.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

/** 最小 UI 原语 mock（ChangesTab 需要 Button）。 */
const ui: UIPrimitives = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Button: (props: any) => <button type="button" {...props} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Modal: (props: any) => <div>{props.children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Toast: (props: any) => <div>{props.text}</div>,
} as unknown as UIPrimitives

function snapshot(changes: readonly { path: string; status: string; staged?: boolean }[]): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false,
    dirty: changes.length > 0,
    staged: changes.filter((c) => c.staged).length,
    modified: changes.filter((c) => !c.staged && c.status !== 'untracked').length,
    untracked: changes.filter((c) => c.status === 'untracked').length,
    ahead: 0, behind: 0, lastCommit: null, recentCommits: [],
    changes: changes.map((c) => ({
      path: c.path, status: c.status as 'modified', staged: c.staged === true, isDirectory: false,
    })),
    truncated: false, refreshIntervalMs: 30_000, checkedAt: Date.now(),
  }
}

const okDiff = (text: string): GitQueryOutcome => ({ ok: true, value: { kind: 'diff', path: 'a.ts', text } })

const SIMPLE_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 old
-new line
+new line changed
`

/** 点选复选框（jsdom click 触发 React onChange）。 */
async function clickCheckbox(h: { container: HTMLElement }, path: string): Promise<void> {
  const box = h.container.querySelector(`input[type="checkbox"][aria-label="${path}"]`) as HTMLInputElement | null
  if (box === null) throw new Error(`checkbox not found: ${path}`)
  box.click()
  await new Promise((r) => setTimeout(r, 10))
}

/** 填写提交信息。 */
async function typeMessage(h: { container: HTMLElement }, text: string): Promise<void> {
  const area = h.container.querySelector('textarea') as HTMLTextAreaElement | null
  if (area === null) throw new Error('textarea not found')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(area, text)
  area.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 10))
}

async function clickCommit(h: { container: HTMLElement }): Promise<void> {
  const buttons = [...h.container.querySelectorAll('button')]
  const commit = buttons.find((b) => b.textContent === t('center.commit'))
  if (commit === undefined) throw new Error('commit button not found')
  commit.click()
  await new Promise((r) => setTimeout(r, 10))
}

describe('ChangesTab — 缺陷复现', () => {
  it('C-A: 选择集随快照修剪——失效路径不得进入 commit（回归锁，C1 修复）', async () => {
    const executed: GitAction[] = []
    const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => ({ ok: false, message: 'x' })
    const execute = async (action: GitAction): Promise<boolean> => { executed.push(action); return true }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const renderWith = async (changes: readonly { path: string; status: string; staged?: boolean }[]): Promise<void> => {
      root.render(
        <UIPrimitivesProvider value={ui}>
          <ChangesTab snapshot={snapshot(changes)} busy={false} execute={execute} query={query} t={t} openRequest={null} />
        </UIPrimitivesProvider>,
      )
      await new Promise((r) => setTimeout(r, 20))
    }
    // 快照1：未跟踪 b.txt + 未暂存 a.ts；用户勾选 b.txt。
    await renderWith([{ path: 'b.txt', status: 'untracked' }, { path: 'a.ts', status: 'modified' }])
    await clickCheckbox({ container }, 'b.txt')
    // 快照2（30s 轮询后）：agent 删除了 b.txt —— 行消失，无法反选。
    await renderWith([{ path: 'a.ts', status: 'modified' }])
    // 提交所选（此时可见列表只有 a.ts，且用户并未勾选它）。
    await typeMessage({ container }, 'msg')
    await clickCommit({ container })
    root.unmount()
    const commit = executed.find((a) => a.kind === 'commit')
    // eslint-disable-next-line no-console
    console.log('[C-A] commit action:', JSON.stringify(commit))
    // 回归锁：失效路径 b.txt 不得进入 commit（选择集随快照修剪，C1）。
    expect(commit).toBeDefined()
    expect((commit as { paths?: string[] } | undefined)?.paths ?? []).not.toContain('b.txt')
  }, 20_000)

  it('C-B: diff 查询失败显示错误态而非「无文件变更」（回归锁，C4 修复）', async () => {
    const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> =>
      q.kind === 'diff' ? { ok: false, message: 'fatal: timeout' } : { ok: false, message: 'x' }
    const execute = async (): Promise<boolean> => true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <UIPrimitivesProvider value={ui}>
        <ChangesTab snapshot={snapshot([{ path: 'a.ts', status: 'modified' }])} busy={false} execute={execute} query={query} t={t} openRequest={null} />
      </UIPrimitivesProvider>,
    )
    await new Promise((r) => setTimeout(r, 20))
    const nameBtn = container.querySelector('button.dsh-git-ui__row button, .dsh-git-ui__row .changeName') as HTMLElement | null
      ?? [...container.querySelectorAll('button')].find((b) => b.textContent === 'a.ts') ?? null
    if (nameBtn === null) throw new Error('file name button not found')
    nameBtn.click()
    await new Promise((r) => setTimeout(r, 120))
    const text = container.textContent ?? ''
    root.unmount()
    // 回归锁：失败呈现专属错误文案（C4），不得再误显「无文件变更」。
    expect(text).toContain(zh['diff.loadFailed'])
    expect(text).not.toContain(zh['center.diffEmpty'])
  }, 20_000)

  it('C-C: 轮询快照触发的重取保持静默——内容不卸载、不闪 loading（回归锁，C5 修复）', async () => {
    // jsdom 的 clientHeight 恒 0——窗口化切片会算出空窗口（diff 行不渲染）。
    // 模拟一个 400px 视口让 DiffSideBySide 真正挂载行，才能断言「内容在场」。
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
      try {
      let diffCalls = 0
      const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
      if (q.kind === 'diff') {
        diffCalls += 1
        await new Promise((r) => setTimeout(r, 30))
        return okDiff(SIMPLE_DIFF)
      }
      return { ok: false, message: 'x' }
      }
      const execute = async (): Promise<boolean> => true
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      const renderWith = async (checkedAt: number): Promise<void> => {
      root.render(
        <UIPrimitivesProvider value={ui}>
          <ChangesTab snapshot={snapshot([{ path: 'a.ts', status: 'modified' }])} busy={false} execute={execute} query={query} t={t} openRequest={null} />
        </UIPrimitivesProvider>,
      )
      await new Promise((r) => setTimeout(r, 60))
      }
      await renderWith(1_000)
      // 打开对照。
      const nameBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'a.ts')
      if (nameBtn === undefined) throw new Error('file button not found')
      nameBtn.click()
      await new Promise((r) => setTimeout(r, 80))
      const callsAfterOpen = diffCalls
      // 30s 轮询推送新快照对象（内容完全一致，checkedAt 不同）。
      await renderWith(31_000)
      const duringPoll = container.textContent ?? ''
      await new Promise((r) => setTimeout(r, 80))
      const afterPoll = container.textContent ?? ''
      root.unmount()
      // 回归锁（C5）：重取静默进行——diff 内容全程在场（DiffSideBySide 不卸载，
      // 滚动/折叠态得以保留），不闪 loading；且重取确实发生（内容保持新鲜）。
      expect(duringPoll).toContain('new line changed')
      expect(duringPoll).not.toContain(zh['center.loading'])
      expect(afterPoll).toContain('new line changed')
      expect(diffCalls).toBe(callsAfterOpen + 1)
    } finally {
      // 删除本测试定义的 own 属性即可（原型链上的 jsdom 原值自然回退）。
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  }, 20_000)
})
