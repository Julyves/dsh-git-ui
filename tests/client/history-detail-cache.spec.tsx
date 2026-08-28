// @vitest-environment jsdom
/**
 * 提交详情加载体验测试（复审-UX）：
 *   - 同一提交重复点击：走 LRU 缓存瞬显，零重复 RPC、零「加载…」闪烁；
 *   - 首次点击未缓存提交：右栏显示骨架屏（.dsh-git-ui__skel-bar），
 *     不再整区切换「加载…」文字；头部（主题/作者/时间）自列表行数据
 *     即时渲染，无等待；
 *   - 同提交在途连点：去重，不重复发 show RPC；
 *   - 缓存命中跨点选往返：A→B→A 第三次访问 A 零 RPC。
 */
import { describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { HistoryTab } from '../../src/client/center/history/HistoryTab.tsx'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitCommit, GitQueryRequest, GitQueryResult, GraphCommit } from '../../src/host/types.ts'
import type { GitQueryOutcome } from '../../src/client/controller.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })

function commitOf(hash: string, subject: string): GraphCommit {
  return { hash, shortHash: hash.slice(0, 7), subject, author: 'Alice', dateIso: '2026-01-01T00:00:00Z', parents: [], refs: [] }
}

const A = commitOf('aaaaaaaa1', 'commit A subject')
const B = commitOf('bbbbbbbb2', 'commit B subject')

type ShowOutcome = { ok: true; value: Extract<GitQueryResult, { kind: 'show' }> }

function showResult(ref: string): ShowOutcome {
  const meta: GitCommit = { hash: ref, shortHash: ref.slice(0, 7), subject: ref === A.hash ? A.subject : B.subject, author: 'Alice', dateIso: '2026-01-01T00:00:00Z' }
  const stats = ref === A.hash
    ? [{ path: 'src/a1.ts', status: 'modified' as const }]
    : [{ path: 'src/b2.ts', status: 'modified' as const }]
  return { ok: true, value: { kind: 'show', ref, commit: meta, body: 'body of ' + ref, stats } }
}

/** show 桩：记录调用序列；holdRef[ref] 存在时挂起（测试手动放行）。 */
function makeQuery(commits: readonly GraphCommit[] = [A, B]) {
  const showLog: string[] = []
  const held: Record<string, Array<(v: GitQueryOutcome) => void>> = {}
  const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
    if (q.kind === 'show') {
      showLog.push(q.ref)
      if (held[q.ref] !== undefined) {
        return await new Promise<GitQueryOutcome>((resolve) => { held[q.ref]!.push(resolve) })
      }
      return showResult(q.ref)
    }
    if (q.kind === 'history') {
      return { ok: true, value: { kind: 'history', commits, total: commits.length } }
    }
    if (q.kind === 'branches') return { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [], remote: [] } }
    if (q.kind === 'tags') return { ok: true, value: { kind: 'tags', tags: [] } }
    return { ok: true, value: { kind: 'authors', authors: [] } }
  }
  const release = (ref: string): void => {
    const waiters = held[ref] ?? []
    delete held[ref]
    for (const resolve of waiters) resolve(showResult(ref))
  }
  return { showLog, query, hold: (ref: string) => { held[ref] = [] }, release }
}

async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0))
}

async function mount(query: ReturnType<typeof makeQuery>['query']): Promise<{ container: HTMLElement; root: Root; rows: HTMLButtonElement[] }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<HistoryTab query={query} run={run} t={t} />)
  await flush()
  const rows = Array.from(container.querySelectorAll('button.dsh-git-ui__commit-row')) as HTMLButtonElement[]
  return { container, root, rows }
}

describe('HistoryTab — 提交详情缓存与加载体验', () => {
  it('同提交重复点击走缓存：零重复 RPC、无「加载…」闪烁', async () => {
    const h = makeQuery()
    const { container, root, rows } = await mount(h.query)
    expect(rows).toHaveLength(2)

    // 首次点击 A:1 次 show,文件树显示 a1.ts。
    rows[0]!.click()
    await flush()
    expect(h.showLog).toEqual([A.hash])
    expect(container.textContent).toContain('a1.ts')

    // 重复点击 A:零新增 RPC,内容持续显示。
    rows[0]!.click()
    rows[0]!.click()
    await flush()
    expect(h.showLog).toEqual([A.hash])
    expect(container.textContent).toContain('a1.ts')
    expect(container.textContent).not.toContain(t('center.loading'))
    root.unmount()
  })

  it('首次点击未缓存提交:骨架屏占位(无「加载…」文字),头部即时渲染', async () => {
    const h = makeQuery()
    h.hold(B.hash) // B 的 show 挂起
    const { container, root, rows } = await mount(h.query)
    rows[0]!.click()
    await flush()
    expect(container.textContent).toContain('a1.ts')

    // 点击 B:在途挂起期间——骨架屏在场,「加载…」文字不在场,
    // 头部主题自列表行数据即时切到 B。
    rows[1]!.click()
    await flush(3)
    expect(container.querySelector('.dsh-git-ui__skel-bar')).not.toBeNull()
    expect(container.textContent).not.toContain(t('center.loading'))
    expect(container.textContent).toContain('commit B subject')
    // 旧的 A 文件树已让位(不串显)。
    expect(container.textContent).not.toContain('a1.ts')

    h.release(B.hash)
    await flush()
    expect(container.textContent).toContain('b2.ts')
    root.unmount()
  })

  it('同提交在途连点去重;A→B→A 第三次访问 A 零 RPC', async () => {
    const h = makeQuery()
    h.hold(B.hash)
    const { container, root, rows } = await mount(h.query)
    rows[0]!.click()
    await flush()

    rows[1]!.click() // B 在途挂起
    await flush(3)
    rows[1]!.click() // 在途连点:去重
    rows[1]!.click()
    await flush(3)
    expect(h.showLog.filter((r) => r === B.hash)).toHaveLength(1)

    h.release(B.hash)
    await flush()
    expect(container.textContent).toContain('b2.ts')

    rows[0]!.click() // 回到 A:缓存命中,零 RPC
    await flush()
    expect(h.showLog.filter((r) => r === A.hash)).toHaveLength(1)
    expect(container.textContent).toContain('a1.ts')
    root.unmount()
  })

  it('连点多条目无堆叠:旧头部/正文节点被替换,不残留(重复 key 回归锁)', async () => {
    const C = commitOf('ccccccc3', 'commit C subject')
    const D = commitOf('ddddddd4', 'commit D subject')
    const h = makeQuery([A, B, C, D])
    const { container, root, rows } = await mount(h.query)
    expect(rows).toHaveLength(4)
    // 依序点击 A→B→C→D:每一步旧内容必须被替换(曾因同父容器重复 key
    // ——头部与正文用相同哈希值——React 调和未定义,旧节点累积成堆叠)。
    for (const row of rows) {
      row.click()
      await flush(4)
    }
    expect(container.textContent).toContain('commit D subject')
    expect(container.textContent).toContain('body of ddddddd4')
    // 详情区只允许存在当前提交的 3 个表面(文件树/头部/正文)——旧提交的
    // 头部/正文残留即堆叠复发。
    const detailEls = Array.from(container.querySelectorAll('.dsh-git-ui__detail-in'))
    expect(detailEls).toHaveLength(3)
    const detailText = detailEls.map((el) => el.textContent ?? '').join('|')
    expect(detailText).toContain('commit D subject')
    expect(detailText).toContain('body of ddddddd4')
    expect(detailText).not.toContain('commit A subject')
    expect(detailText).not.toContain('commit B subject')
    expect(detailText).not.toContain('commit C subject')
    expect(detailText).not.toContain('body of aaaaaaa1')
    root.unmount()
  })
})
