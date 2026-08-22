import { describe, expect, it } from 'vitest'
import {
  gitActionResultSchema, gitActionRequestSchema, gitActionSchema,
  gitInfoRemote, gitQueryResultSchema, gitQueryRequestSchema,
  gitSnapshotFailureSchema, gitSnapshotResultSchema, gitSnapshotSchema,
  gitStorageReadRequestSchema, gitStorageReadResultSchema, gitStorageWriteRequestSchema, gitStorageWriteResultSchema,
} from '../../src/client/remote.ts'
import type { GitAction, GitActionResult, GitSnapshot, GitSnapshotResult, GitStorageReadResult, GitStorageWriteResult, GraphCommit } from '../../src/host/types.ts'

/** A host-typed sample snapshot — the hand-written schemas must accept it. */
function sampleSnapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false, dirty: true,
    staged: 1, modified: 2, untracked: 3, ahead: 1, behind: 2,
    lastCommit: { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'fix things', author: 'Alice', dateIso: '2026-08-16T10:00:00+08:00' },
    recentCommits: [
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'fix things', author: 'Alice', dateIso: '2026-08-16T10:00:00+08:00' },
      { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'add feature', author: 'Bob', dateIso: '2026-08-15T09:00:00+08:00' },
    ],
    changes: [
      { path: 'src/a.ts', status: 'modified', staged: true, isDirectory: false },
      { path: 'new.txt', status: 'untracked', staged: false, isDirectory: false },
      { path: 'old.ts', status: 'renamed', staged: true, isDirectory: false },
    ],
    truncated: false, refreshIntervalMs: 30_000, checkedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('git snapshot schemas', () => {
  it('accepts a host-typed ready snapshot', () => {
    const sample = sampleSnapshot()
    const parsed = gitSnapshotSchema.parse(sample)
    expect(parsed).toMatchObject({
      root: '/repo', branch: 'main', staged: 1, ahead: 1,
      lastCommit: { shortHash: 'aaaaaaa' },
      recentCommits: [{ hash: 'a'.repeat(40) }, { hash: 'b'.repeat(40) }],
    })
    expect(parsed.changes).toHaveLength(3)
    expect(parsed.changes[2]).toEqual({ path: 'old.ts', status: 'renamed', staged: true, isDirectory: false })
  })

  it('keeps the authoritative isDirectory flag across the wire (regression: .agent/)', () => {
    // zod z.object 曾因未声明 isDirectory 在解码时 strip 该字段，使展示层
    // 目录识别（GitChange.isDirectory）整体失效——此处强制校验 wire 保留。
    const parsed = gitSnapshotSchema.parse(sampleSnapshot({
      staged: 0, modified: 0, untracked: 1, dirty: true,
      changes: [
        { path: '.agent/', status: 'untracked', staged: false, isDirectory: true },
        { path: 'src/a.ts', status: 'modified', staged: true, isDirectory: false },
      ],
    }))
    expect(parsed.changes[0]).toEqual({ path: '.agent/', status: 'untracked', staged: false, isDirectory: true })
    expect(parsed.changes[1]).toEqual({ path: 'src/a.ts', status: 'modified', staged: true, isDirectory: false })
  })

  it('accepts a detached and unborn snapshot', () => {
    const detached = gitSnapshotSchema.parse(sampleSnapshot({ branch: null, head: 'abc1234', unborn: false }))
    expect(detached.branch).toBeNull()
    const unborn = gitSnapshotSchema.parse(sampleSnapshot({ head: null, unborn: true, dirty: false, recentCommits: [], lastCommit: null }))
    expect(unborn.unborn).toBe(true)
  })

  it('rejects a malformed snapshot', () => {
    const bad = { ...sampleSnapshot(), staged: 'many' } as unknown
    expect(() => gitSnapshotSchema.parse(bad)).toThrow()
  })

  it('accepts every failure shape', () => {
    const failures: readonly GitSnapshotResult[] = [
      { ok: false, error: { code: 'session-not-found', sessionId: 's1' } },
      { ok: false, error: { code: 'cwd-unavailable', sessionId: 's1' } },
      { ok: false, error: { code: 'path-not-found', path: '/gone' } },
      { ok: false, error: { code: 'git-unavailable', detail: 'spawn failed' } },
      { ok: false, error: { code: 'timeout' } },
      { ok: false, error: { code: 'not-a-git-repo' } },
    ]
    for (const failure of failures) {
      const parsed = gitSnapshotResultSchema.parse(failure)
      expect(parsed.ok).toBe(false)
    }
    expect(() => gitSnapshotFailureSchema.parse({ code: 'unknown' })).toThrow()
  })

  it('rejects a failure with an unknown code', () => {
    expect(() => gitSnapshotResultSchema.parse({ ok: false, error: { code: 'exploded' } })).toThrow()
  })
})

describe('gitInfoRemote contribution', () => {
  it('declares the gitInfo/snapshot endpoint with strict codecs', () => {
    expect(gitInfoRemote.package).toBe('dsh-git-ui')
    expect(gitInfoRemote.descriptors).toHaveLength(5)
    const descriptor = gitInfoRemote.descriptors[0]
    expect(descriptor).toMatchObject({
      service: 'gitInfo', namespace: 'gitInfo', method: 'snapshot',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [{ name: 'request', wire: 'request', source: 'json' }],
      result: { mode: 'strict' },
    })
    if (descriptor === undefined) throw new Error('missing descriptor')
    expect(descriptor.parameters[0]?.codec.mode).toBe('strict')
    expect(descriptor.result.mode).toBe('strict')
  })

  it('declares the storageRead / storageWrite endpoints', () => {
    const read = gitInfoRemote.descriptors.find((d) => d.method === 'storageRead')
    const write = gitInfoRemote.descriptors.find((d) => d.method === 'storageWrite')
    expect(read).toMatchObject({ service: 'gitInfo', namespace: 'gitInfo', method: 'storageRead' })
    expect(write).toMatchObject({ service: 'gitInfo', namespace: 'gitInfo', method: 'storageWrite' })
    expect(read?.result.mode).toBe('strict')
    expect(write?.result.mode).toBe('strict')
  })

  it('round-trips a snapshot through the wire codecs', () => {
    const descriptor = gitInfoRemote.descriptors[0]
    if (descriptor === undefined) throw new Error('missing descriptor')
    const parameter = descriptor.parameters[0]
    if (parameter === undefined) throw new Error('missing parameter')
    const request = parameter.codec.schema.parse({ sessionId: 's1' })
    expect(request).toEqual({ sessionId: 's1' })
    const ok = descriptor.result.schema.parse({ ok: true, value: sampleSnapshot() })
    expect(ok).toMatchObject({ ok: true })
  })
})

describe('git action schemas', () => {
  it('accepts every host-typed action shape', () => {
    const actions: readonly GitAction[] = [
      { kind: 'stage', paths: ['a.txt'] },
      { kind: 'stage-all' },
      { kind: 'unstage', paths: ['a.txt', 'b/c.txt'] },
      { kind: 'unstage-all' },
      { kind: 'discard', paths: ['a.txt'] },
      { kind: 'discard-all' },
      { kind: 'commit', message: 'fix' },
      { kind: 'commit', message: 'fix', paths: ['a.txt'] },
    ]
    for (const action of actions) {
      expect(() => gitActionSchema.parse(action)).not.toThrow()
    }
    const parsed = gitActionRequestSchema.parse({ sessionId: 's1', action: { kind: 'stage', paths: ['a.txt'] } })
    expect(parsed.action).toMatchObject({ kind: 'stage' })
  })

  it('rejects unknown action kinds and malformed shapes', () => {
    expect(() => gitActionSchema.parse({ kind: 'reset', paths: [] })).toThrow()
    expect(() => gitActionSchema.parse({ kind: 'stage' })).toThrow()
    expect(() => gitActionSchema.parse({ kind: 'commit', message: 'x', paths: 'a.txt' })).toThrow()
  })

  it('accepts host-typed action results', () => {
    const success: GitActionResult = { ok: true, snapshot: sampleSnapshot(), output: 'done' }
    expect(gitActionResultSchema.parse(success)).toMatchObject({ ok: true })
    const failure: GitActionResult = { ok: false, error: { code: 'git-error', message: 'nothing to commit' } }
    expect(gitActionResultSchema.parse(failure)).toMatchObject({ ok: false })
    expect(() => gitActionResultSchema.parse({ ok: false, error: { code: 'exploded' } })).toThrow()
  })
})

describe('gitInfoRemote run endpoint', () => {
  it('declares gitInfo/run with strict codecs and cancellation', () => {
    const runDescriptor = gitInfoRemote.descriptors[1]
    expect(runDescriptor).toMatchObject({
      service: 'gitInfo', namespace: 'gitInfo', method: 'run',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [{ name: 'request', wire: 'request', source: 'json' }],
      result: { mode: 'strict' },
    })
    if (runDescriptor === undefined) throw new Error('missing run descriptor')
    expect(runDescriptor.parameters[0]?.codec.mode).toBe('strict')
  })

  it('round-trips a run request and result through the codecs', () => {
    const runDescriptor = gitInfoRemote.descriptors[1]
    if (runDescriptor === undefined) throw new Error('missing run descriptor')
    const parameter = runDescriptor.parameters[0]
    if (parameter === undefined) throw new Error('missing parameter')
    const request = parameter.codec.schema.parse({ sessionId: 's1', action: { kind: 'commit', message: 'fix' } })
    expect(request).toMatchObject({ sessionId: 's1' })
    const ok = runDescriptor.result.schema.parse({ ok: true, snapshot: sampleSnapshot() })
    expect(ok).toMatchObject({ ok: true })
  })

  it('round-trips a local-changes-block run failure through the codecs (wire contract sync)', () => {
    // host 新增错误码必须同步进 gitOperationErrorSchema，否则 strict 解码
    // reject → client 把可预期业务错误改写为晦涩 git-error，友好化失效。
    const runDescriptor = gitInfoRemote.descriptors[1]
    if (runDescriptor === undefined) throw new Error('missing run descriptor')
    const failure = runDescriptor.result.schema.parse({
      ok: false,
      error: { code: 'local-changes-block', message: 'error: Your local changes ... would be overwritten by checkout ... Aborting' },
    })
    expect(failure).toMatchObject({ ok: false, error: { code: 'local-changes-block' } })
  })
})

describe('gitInfoRemote query endpoint', () => {
  it('round-trips a history result carrying parents and refs (wire contract sync)', () => {
    // 宿主类型的 GraphCommit（含 parents/refs）必须被客户端 schema 接受，
    // 防止 host types 与 remote.ts 手工镜像漂移。
    const commit: GraphCommit = {
      hash: 'a'.repeat(40),
      shortHash: 'aaaaaaa',
      subject: 'merge feature',
      author: 'Alice',
      dateIso: '2026-01-01T00:00:00Z',
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      refs: [
        { kind: 'branch', name: 'main', head: true },
        { kind: 'remote', name: 'origin/main', head: false },
        { kind: 'tag', name: 'v1.0', head: false },
      ],
    }
    const parsed = gitQueryResultSchema.parse({ kind: 'history', commits: [commit], total: 1 })
    expect(parsed).toMatchObject({ kind: 'history', total: 1 })
    const request = gitQueryRequestSchema.parse({ sessionId: 's1', query: { kind: 'history', limit: 50, skip: 0 } })
    expect(request).toMatchObject({ sessionId: 's1' })
  })

  it('rejects a graph commit missing refs (strict mirror)', () => {
    const incomplete = { hash: 'h', shortHash: 'h', subject: 's', author: 'a', dateIso: 'd', parents: [] }
    expect(() => gitQueryResultSchema.parse({ kind: 'history', commits: [incomplete], total: 1 })).toThrow()
  })
})

describe('git storage schemas', () => {
  it('accepts every host-typed storage result shape', () => {
    const reads: readonly GitStorageReadResult[] = [
      { ok: true, value: '{"v":2}' },
      { ok: true, value: null },
      { ok: false, error: { code: 'invalid-file', message: 'bad name' } },
      { ok: false, error: { code: 'io-error', message: 'disk full' } },
    ]
    for (const result of reads) {
      expect(() => gitStorageReadResultSchema.parse(result)).not.toThrow()
    }
    const writes: readonly GitStorageWriteResult[] = [
      { ok: true },
      { ok: false, error: { code: 'io-error', message: 'denied' } },
    ]
    for (const result of writes) {
      expect(() => gitStorageWriteResultSchema.parse(result)).not.toThrow()
    }
  })

  it('rejects unknown failure codes and malformed requests', () => {
    expect(() => gitStorageReadResultSchema.parse({ ok: false, error: { code: 'forbidden', message: 'x' } })).toThrow()
    expect(() => gitStorageWriteResultSchema.parse({ ok: 'yes' })).toThrow()
    expect(() => gitStorageReadRequestSchema.parse({ file: 42 })).toThrow()
    expect(() => gitStorageWriteRequestSchema.parse({ file: 'a.json' })).toThrow()
  })

  it('round-trips request shapes', () => {
    expect(gitStorageReadRequestSchema.parse({ file: 'settings.json' })).toEqual({ file: 'settings.json' })
    const write = gitStorageWriteRequestSchema.parse({ file: 'settings.json', data: '{}' })
    expect(write).toMatchObject({ file: 'settings.json', data: '{}' })
  })
})
