// @vitest-environment jsdom
/**
 * 「无 Git 仓库」pill 轮询闪烁回归测试。
 *
 * 根因：GitPill 旧实现只记忆 ready 视图——error 态会话（not-a-git-repo /
 * git-unavailable）永远不会 ready，每次 30s 轮询的 loading 相位
 * display=loading → 返回 null → 整颗 pill 卸载，RPC 返回后重挂载，
 * 停留页面可见周期性闪烁。
 * 修复：记忆任意稳定态（ready/error/cold/no-cwd），loading 相位渲染
 * 上次稳定视图——降级 pill 保持挂载、内容不变。
 */
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GitPill } from '../../src/client/GitPill.tsx'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import type { GitView, GitQueryOutcome } from '../../src/client/controller.ts'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitQueryRequest } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const ui: UIPrimitives = {
  Modal: (props) => (props.open ? <div>{props.children}</div> : null),
  Button: (props) => <button type="button">{props.children}</button>,
  Toast: () => null,
}

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })
const query = async (_q: GitQueryRequest['query']): Promise<GitQueryOutcome> => ({ ok: false, message: 'stub' })

/** 可变视图桩：测试逐帧推进视图状态机。 */
let currentView: GitView = { state: 'cold' }
const useGit = <S,>(selector?: (view: GitView) => S): S => (selector ?? ((v: GitView) => v as unknown as S))(currentView)
const useSession = <S,>(selector: (snapshot: { turnEnds: ReadonlyMap<number, number> }) => S): S => selector({ turnEnds: new Map<number, number>() })

function pillTree(): ReactElement {
  return (
    <UIPrimitivesProvider value={ui}>
      <GitPill
        sessionId="s1" useGit={useGit} useSession={useSession}
        hooks={{ git: { subscribe: () => () => {}, getSnapshot: () => currentView } }}
        refresh={async () => {}} run={run} query={query}
        storageRead={async () => null} storageWrite={async () => true} t={t}
      />
    </UIPrimitivesProvider>
  )
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/** 挂载 + 随视图变化逐帧重渲（模拟 useGit 快照推进）。 */
async function frame(root: Root): Promise<void> {
  root.render(pillTree())
  await flush()
}

describe('GitPill — 降级态轮询不闪烁（回归）', () => {
  it('error(not-a-git-repo) 会话：轮询 loading 相位 pill 保持挂载', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // 首次加载完成：进入 not-a-git-repo 错误态。
    currentView = { state: 'error', error: { code: 'not-a-git-repo' } }
    await frame(root)
    expect(container.querySelector('.dsh-git-ui__pill')?.textContent).toContain(zh['pill.noRepo'])

    // 30s 轮询触发 refresh → 控制器置 loading（RPC 在途）。
    // 旧实现此刻返回 null（pill 卸载）→ 闪烁；修复后渲染上次稳定 error 视图。
    currentView = { state: 'loading' }
    await frame(root)
    const duringLoad = container.querySelector('.dsh-git-ui__pill')
    expect(duringLoad).not.toBeNull()
    expect(duringLoad?.textContent).toContain(zh['pill.noRepo'])

    // RPC 返回：错误态恢复（新对象同内容）——pill 持续在场，无卸载。
    currentView = { state: 'error', error: { code: 'not-a-git-repo' } }
    await frame(root)
    expect(container.querySelector('.dsh-git-ui__pill')?.textContent).toContain(zh['pill.noRepo'])

    root.unmount()
  })

  it('git-unavailable 错误态同样保持（记忆任意稳定态）', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    currentView = { state: 'error', error: { code: 'git-unavailable', detail: 'boom' } }
    await frame(root)
    expect(container.querySelector('.dsh-git-ui__pill')?.textContent).toContain(zh['pill.unavailable'])

    currentView = { state: 'loading' }
    await frame(root)
    expect(container.querySelector('.dsh-git-ui__pill')?.textContent).toContain(zh['pill.unavailable'])
    root.unmount()
  })

  it('首次加载（无任何稳定态）仍渲染 null——首屏行为不变', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    currentView = { state: 'loading' }
    await frame(root)
    expect(container.querySelector('.dsh-git-ui__pill')).toBeNull()
    root.unmount()
  })
})
