// @vitest-environment jsdom
/**
 * 变更页「提交基线视图」测试（历史页文件树深链）：
 *   - commitFileRequest 到达 → 以 commit 基线加载，工具栏出现提交哈希徽标
 *     （短哈希 + title 全哈希）、内容渲染该提交中该文件的变更；
 *   - 提交视图下无「上一处/下一处」导航（导航序列是工作区变更）；
 *   - 关闭 → 回到常规空态（选择文件提示）。
 */
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChangesTab } from '../../src/client/center/changes/ChangesTab.tsx'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import type { GitQueryOutcome } from '../../src/client/controller.ts'
import { zh } from '../../src/client/locales.ts'
import type { GitQueryRequest, GitQueryResult, GitSnapshot } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const ui: UIPrimitives = {
  Modal: (props) => (props.open ? <div>{props.children}</div> : null),
  Button: (props) => <button type="button">{props.children}</button>,
  Toast: () => null,
}

const SNAPSHOT: GitSnapshot = {
  root: '~/p/demo', branch: 'main', head: 'abc1234', unborn: false,
  dirty: true, staged: 1, modified: 1, untracked: 0, ahead: 0, behind: 0,
  lastCommit: null, recentCommits: [], changes: [], truncated: false,
  refreshIntervalMs: 30_000, checkedAt: 0,
}

const HASH = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555'
const COMMIT_DIFF = [
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,2 +1,2 @@',
  ' one',
  '-oldLINE',
  '+newLINE',
].join('\n')

/** 记录 diff 查询的基线；commit 基线返回 COMMIT_DIFF。 */
function makeQuery() {
  const bases: string[] = []
  const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
    if (q.kind === 'diff') {
      bases.push(q.base)
      const value: GitQueryResult = q.base === 'commit'
        ? { kind: 'diff', path: q.path, text: COMMIT_DIFF }
        : { kind: 'diff', path: q.path, text: '' }
      return { ok: true, value }
    }
    return { ok: false, message: 'stub' }
  }
  return { bases, query }
}

async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

function tree(query: ReturnType<typeof makeQuery>['query'], commitFileRequest: { path: string; hash: string; nonce: number } | null): ReactElement {
  return (
    <UIPrimitivesProvider value={ui}>
      <ChangesTab
        snapshot={SNAPSHOT} busy={false}
        execute={async () => true}
        query={query}
        t={t}
        openRequest={null}
        commitFileRequest={commitFileRequest}
      />
    </UIPrimitivesProvider>
  )
}

describe('ChangesTab — 提交基线视图（历史页文件树深链）', () => {
  it('请求到达：commit 基线查询 + 哈希徽标 + 内容渲染；无前后导航；关闭回空态', async () => {
    // jsdom 的 clientHeight 恒 0——窗口化切片会算出空窗口（diff 行不渲染）。
    // 模拟一个 400px 视口让 DiffSideBySide 真正挂载行。
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
    try {
      const { bases, query } = makeQuery()
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      root.render(tree(query, { path: 'x.txt', hash: HASH, nonce: 1 }))
      await flush()

    // 以 commit 基线发起查询。
    expect(bases).toContain('commit')
    // 工具栏：提交哈希徽标（短哈希文本 + title 全哈希）+ 文件名。
    const badge = container.querySelector(`[title="${HASH}"]`)
    expect(badge?.textContent).toBe(HASH.slice(0, 7))
    expect(container.textContent).toContain('x.txt')
    // 内容：该提交中此文件的变更行在场。
    expect(container.textContent).toContain('oldLINE')
    expect(container.textContent).toContain('newLINE')
    // 提交视图下无「上一处/下一处」导航。
    expect(container.querySelector(`button[aria-label="${zh['diff.prev']}"]`)).toBeNull()
    expect(container.querySelector(`button[aria-label="${zh['diff.next']}"]`)).toBeNull()

    // 关闭 → 回到常规空态（选择文件提示），哈希徽标消失。
    ;(container.querySelector(`button[aria-label="${zh['center.close']}"]`) as HTMLButtonElement).click()
    await flush()
    expect(container.querySelector(`[title="${HASH}"]`)).toBeNull()
    expect(container.textContent).toContain(zh['center.selectFileDiff'])

      root.unmount()
    } finally {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  })
})
