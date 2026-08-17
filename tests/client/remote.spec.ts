import { describe, expect, it } from 'vitest'
import {
  gitActionResultSchema, gitActionRequestSchema, gitActionSchema,
  gitInfoRemote, gitSnapshotFailureSchema, gitSnapshotResultSchema, gitSnapshotSchema,
} from '../../src/client/remote.ts'
import type { GitAction, GitActionResult, GitSnapshot, GitSnapshotResult } from '../../src/host/types.ts'

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
      { path: 'src/a.ts', status: 'modified', staged: true },
      { path: 'new.txt', status: 'untracked', staged: false },
      { path: 'old.ts', status: 'renamed', staged: true },
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
    expect(parsed.changes[2]).toEqual({ path: 'old.ts', status: 'renamed', staged: true })
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
    expect(gitInfoRemote.descriptors).toHaveLength(3)
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
})
