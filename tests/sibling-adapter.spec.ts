/**
 * 兄弟会话写路径适配(sibling-adapter)单元测试。
 * 覆盖:同 cwd 枚举、自身 subagent 子树排除、cwd 不匹配跳过、
 * 冷会话跳过、seed 边界(他人历史不计)、仓库外丢弃。
 */
import { describe, expect, it } from 'vitest'
import { collectSiblingWrites } from '../src/adapters/dsh/sibling-adapter.ts'
import type { SessionsLike } from '../src/adapters/dsh/subagent-adapter.ts'
import type { SessionLike } from '../src/adapters/dsh/session-log.ts'

/** 事件工厂:seed 之前是父历史,之后是该会话自己的工作。 */
function sessionWith(turn: number, calls: Array<[seq: number, name: string, args: string]>, opts: { seedSeq?: number } = {}): SessionLike {
  const seed = opts.seedSeq ?? 1
  const events = [
    { type: 'session/end-seed', seq: seed, time: 1, data: {} },
    { type: 'turn/start', seq: seed + 1, time: 10, data: { turn } },
    ...calls.map(([seq, name, arguments_], index) => ({
      type: 'tool/call', seq, time: 20 + index, data: { turn, callId: `c${index}`, name, arguments: arguments_ },
    })),
  ]
  return { events, seq: seed + 2 + calls.length }
}

function sessionsOf(entries: Array<{ id: string; cwd?: string; meta?: Record<string, unknown> }>, live: Record<string, SessionLike>): SessionsLike {
  return {
    get: (id) => live[id],
    list: () => entries.map((entry) => ({ id: entry.id, header: { ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }), ...(entry.meta === undefined ? {} : { meta: entry.meta }) } })),
  }
}

const ROOT = '/repo'

describe('collectSiblingWrites', () => {
  it('collects same-cwd sibling session writes (post-seed work only)', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: ROOT },
        { id: 'sib', cwd: ROOT },
      ],
      {
        sib: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'sib.ts' })]]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, ROOT, undefined)
    expect([...writes]).toEqual(['sib.ts'])
  })

  it('excludes own subagent subtree (their writes are internal, not sibling)', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: ROOT },
        { id: 'sub', cwd: ROOT, meta: { origin: 'subagent', parentSession: 'self' } },
        { id: 'grandsub', cwd: ROOT, meta: { origin: 'subagent', parentSession: 'sub' } },
        { id: 'sib', cwd: ROOT },
      ],
      {
        sub: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'sub.txt' })]]),
        grandsub: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'grand.txt' })]]),
        sib: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'sib.ts' })]]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, ROOT, undefined)
    expect([...writes]).toEqual(['sib.ts'])
  })

  it('skips sessions with a different or missing cwd (conservative)', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: ROOT },
        { id: 'elsewhere', cwd: '/other/repo' },
        { id: 'nocwd' },
      ],
      {
        elsewhere: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'x.ts' })]]),
        nocwd: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'y.ts' })]]),
      },
    )
    expect((await collectSiblingWrites('self', sessions, ROOT, undefined)).size).toBe(0)
  })

  it('skips cold sessions and undefined sessions service', async () => {
    const cold = sessionsOf([{ id: 'self', cwd: ROOT }, { id: 'sib', cwd: ROOT }], {})
    expect((await collectSiblingWrites('self', cold, ROOT, undefined)).size).toBe(0)
    expect((await collectSiblingWrites('self', undefined, ROOT, undefined)).size).toBe(0)
  })

  it('drops out-of-repo and normalized-escaping paths', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: ROOT },
        { id: 'sib', cwd: ROOT },
      ],
      {
        sib: sessionWith(1, [
          [5, 'write', JSON.stringify({ file_path: '/elsewhere/x.ts' })],
          [6, 'write', JSON.stringify({ file_path: '../escape.ts' })],
          [7, 'write', JSON.stringify({ file_path: 'ok.ts' })],
        ]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, ROOT, undefined)
    expect([...writes]).toEqual(['ok.ts'])
  })
})

describe('collectSiblingWrites — cwd 匹配(P3-6:realpath 归一 + 子目录)', () => {
  it('matches a sibling whose cwd is a symlinked form of the workspace root', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: '/real/repo' },
        { id: 'sib', cwd: '/linked/repo' }, // 启动于符号链接路径
      ],
      {
        sib: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'sib.ts' })]]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, '/real/repo', undefined, {
      realpath: async (path) => (path === '/linked/repo' ? '/real/repo' : path),
    })
    expect([...writes]).toEqual(['sib.ts'])
  })

  it('includes a sibling whose cwd is a subdirectory of the workspace root', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: '/repo' },
        { id: 'subdir', cwd: '/repo/packages/app' },
      ],
      {
        subdir: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'pkg.ts' })]]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, '/repo', undefined)
    expect([...writes]).toEqual(['pkg.ts'])
  })

  it('realpath failure degrades to exact-match (conservative, old behavior)', async () => {
    const sessions = sessionsOf(
      [
        { id: 'self', cwd: '/real/repo' },
        { id: 'sib', cwd: '/linked/repo' },
      ],
      {
        sib: sessionWith(1, [[5, 'write', JSON.stringify({ file_path: 'sib.ts' })]]),
      },
    )
    const writes = await collectSiblingWrites('self', sessions, '/real/repo', undefined, {
      realpath: async () => { throw new Error('ENOENT') },
    })
    expect(writes.size).toBe(0)
  })
})
