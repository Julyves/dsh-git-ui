// @vitest-environment jsdom
/**
 * HistoryTab 加载失败路径复现（bug-hunt 2026-08-26，fix/bug-hunt 分支）。
 *
 * 复现目标 B1：续载页失败 + 滚动容器贴近底部时，底部静置自动续载 effect
 * （deps [commits, loading, hasMore]）在每次失败后因 loading 回落而重触发——
 * 无退避、无终止条件 → 无限失败请求风暴。
 * 本测试断言【期望行为】（重试有界），当前实现下应 FAIL，即为 bug 证据；
 * 修复后本测试转绿成为回归锁。
 *
 * 复现目标 B5：首页 history 查询失败时 UI 显示「无结果」而非错误态——
 * 该断言按【当前错误行为】书写（confirming），修复后应反转为错误文案断言。
 *
 * 备注：不使用 act()——无限更新循环会让 act 永不静默（第一版复现即因此在
 * act 内 15s 超时，这本身是风暴的旁证）；改用裸 createRoot + 真实计时。
 */
import { describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { HistoryTab } from '../../src/client/center/history/HistoryTab.tsx'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitQueryRequest, GraphCommit } from '../../src/host/types.ts'
import type { GitQueryOutcome } from '../../src/client/controller.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

function commit(hash: string, subject: string): GraphCommit {
  return {
    hash, shortHash: hash.slice(0, 7), subject, author: 'a',
    dateIso: '2026-01-01T00:00:00Z', parents: [], refs: [],
  }
}

const okBranches = { ok: true as const, value: { kind: 'branches' as const, current: 'main', defaultBranch: 'main', local: [], remote: [] } }
const okTags = { ok: true as const, value: { kind: 'tags' as const, tags: [] } }
const okAuthors = { ok: true as const, value: { kind: 'authors' as const, authors: [] } }

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })

async function renderTab(query: (q: GitQueryRequest['query']) => Promise<GitQueryOutcome>): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<HistoryTab query={query} run={run} t={t} />)
  await new Promise((r) => setTimeout(r, 20))
  return { container, root }
}

describe('HistoryTab — 加载失败路径（bug 复现）', () => {
  // 回归锁（B1 已修复）：失败后自动续载刹车（listError），重试必须有界。
  it('B1 回归锁: 续载失败贴近底部时重试有界（不再无限风暴）', async () => {
    const historyCalls: number[] = []
    let retryCutoff = 400 // 安全阀：第 400 次重试后放行「补全列表」成功响应终止循环
    // 关键：模拟真实查询延迟（git 子进程 50ms~5s）——立即 resolve 会让
    // loading 的 true→false 被 React 批处理合并成一个无变化渲染，效应
    // 观察不到中间值，循环被「侥幸」刹车（真实世界不存在这种侥幸）。
    const latency = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
      if (q.kind === 'history') {
        historyCalls.push(q.skip)
        if (q.skip === 0) {
          await latency(10)
          return { ok: true, value: { kind: 'history', commits: [commit('a1', 'first')], total: 3 } }
        }
        await latency(25)
        if (historyCalls.filter((s) => s > 0).length < retryCutoff) {
          return { ok: false, message: 'timeout' }
        }
        // 终止响应：补齐到 total 并短于整页 → reachedEnd → 循环自然停止。
        return { ok: true, value: { kind: 'history', commits: [commit('a2', 'x'), commit('a3', 'y')], total: 3 } }
      }
      if (q.kind === 'branches') return okBranches
      if (q.kind === 'tags') return okTags
      return okAuthors
    }
    const { root } = await renderTab(query)
    await new Promise((r) => setTimeout(r, 800))
    const retries = historyCalls.filter((s) => s > 0).length
    // eslint-disable-next-line no-console
    console.log(`[B1] history queries: total=${historyCalls.length} retries(skip>0)=${retries} (cutoff=400 安全阀)`)
    root.unmount()
    // 期望行为：失败后不无限重试（允许 ≤2 次探测——首次触发 + 批处理余波）。
    expect(retries).toBeLessThanOrEqual(2)
  }, 20_000)

  // 回归锁（B5 已修复）：失败态与无结果分文案。
  it('B5 回归锁: 首页查询失败显示错误文案，而非「无结果」', async () => {
    const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> => {
      if (q.kind === 'history') return { ok: false, message: 'fatal: bad regex' }
      if (q.kind === 'branches') return okBranches
      if (q.kind === 'tags') return okTags
      return okAuthors
    }
    const { container, root } = await renderTab(query)
    await new Promise((r) => setTimeout(r, 150))
    const text = container.textContent ?? ''
    // eslint-disable-next-line no-console
    console.log(`[B5] includes loadFailed=${text.includes(zh['history.loadFailed'])} noResults=${text.includes(zh['history.noResults'])}`)
    root.unmount()
    // 修复后行为：错误文案在场,「无结果」不出现。
    expect(text).toContain(zh['history.loadFailed'])
    expect(text).not.toContain(zh['history.noResults'])
  }, 20_000)
})
