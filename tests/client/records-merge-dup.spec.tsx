// @vitest-environment jsdom
/**
 * 记录页 UX 缺陷复现（bug-hunt 第三轮 2026-08-26，fix/bug-hunt 分支）。
 *
 * R-D（中高，已修复）：buildSessions 合并相邻 turn 时三组条目直接拼接不去重——
 *   同一路径被多个 turn 记录（host 归因是 per-turn 的：同一文件在 turn1 和
 *   turn3 都被写过 → 两组 internal 各含该路径；外部文件跨窗口多次修改同理）
 *   合并同一时段后重复出现：同卡片内重复行 + React duplicate key 告警 +
 *   头部徽章计数虚高 + 工具栏「M 个文件」计数虚高。
 * R-T（中，已修复）：records=null 的成因三分——loadFailed=true 才显示
 *   「加载失败」;缺省/False = 首次加载中显示「加载…」。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { RecordsTab } from '../../src/client/records/index.tsx'
import { buildSessions } from '../../src/client/records/derive.ts'
import { zh } from '../../src/client/locales.ts'
import type { TurnWorkRecord, WorkEntry } from '../../src/host/types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false

const t = (key: keyof typeof zh): string => zh[key]

function entry(path: string, firstSeenAt = 0): WorkEntry {
  return { path, status: 'modified', state: 'dirty', firstSeenAt, commitHash: null, attribution: 'inferred' }
}

function turn(n: number, overrides: Partial<TurnWorkRecord>): TurnWorkRecord {
  return {
    turn: n, startAt: n * 1000, endAt: n * 1000 + 500, hasWork: true, narrative: null,
    internal: [], sibling: [], external: [], ...overrides,
  }
}

describe('记录页 — 合并时段重复条目 / 加载态混淆', () => {
  it('R-D1(回归锁): 相邻两 turn 都写了 a.ts → 合并时段 internal 去重', () => {
    const records = [
      turn(1, { internal: [entry('a.ts')] }),
      turn(2, { internal: [entry('a.ts'), entry('b.ts')] }),
    ]
    const sessions = buildSessions(records)
    expect(sessions.length).toBe(1)
    const paths = sessions[0]!.internal.map((e) => e.path)
    // eslint-disable-next-line no-console
    console.log(`[R-D1] merged internal paths=${JSON.stringify(paths)}`)
    // 回归锁：时段内路径唯一（旧实现直接拼接含重复）。
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('R-D2(回归锁): 去重后渲染不产生 duplicate key 告警', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ')
      if (text.includes('key')) errors.push(text)
    })
    const records = [
      turn(1, { internal: [entry('a.ts')] }),
      turn(2, { internal: [entry('a.ts')] }),
      turn(3, { external: [entry('ext.log', 1500)] }),
      turn(4, { external: [entry('ext.log', 2500)] }),
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(
      <RecordsTab records={records} t={t} onOpenDiff={() => {}} initialFilter="internal" />,
    )
    await new Promise((r) => setTimeout(r, 50))
    root.unmount()
    spy.mockRestore()
    // eslint-disable-next-line no-console
    console.log(`[R-D2] duplicate-key errors=${errors.length}`)
    expect(errors.length).toBe(0)
  }, 10_000)

  it('R-T(回归锁): records=null 三分——缺省=加载中;loadFailed=true=加载失败', async () => {
    const render = async (loadFailed?: boolean): Promise<string> => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      root.render(<RecordsTab records={null} loadFailed={loadFailed} t={t} onOpenDiff={() => {}} />)
      await new Promise((r) => setTimeout(r, 30))
      const text = container.textContent ?? ''
      root.unmount()
      container.remove()
      return text
    }
    // 缺省(首次加载中)→ 加载文案,不得误报失败。
    const loading = await render(undefined)
    // eslint-disable-next-line no-console
    console.log(`[R-T] default includes loading=${loading.includes(zh['center.loading'])}`)
    expect(loading).toContain(zh['center.loading'])
    expect(loading).not.toContain(zh['work.loadFailed'])
    // 显式失败 → 失败文案。
    const failed = await render(true)
    expect(failed).toContain(zh['work.loadFailed'])
  }, 10_000)
})
