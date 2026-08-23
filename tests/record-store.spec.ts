import { describe, expect, it } from 'vitest'
import { RecordStore, RECONCILE_PROBE_CAP } from '../src/host/record-store.ts'
import { encodeObservations } from '../src/host/obs-file.ts'
import type { ObservationPersistence } from '../src/host/observation.ts'
import type { PathObservation } from '../src/host/observation.ts'
import type { GitChange } from '../src/host/types.ts'

function change(path: string, status: GitChange['status'] = 'modified'): GitChange {
  return { path, status, staged: false, isDirectory: false }
}

interface MemoryPersistence extends ObservationPersistence {
  written: string | null
}

/** 内存持久化:每会话独立文件(accessor 属性镜像文件内容,便于测试直读)。 */
function memoryPersistence(): MemoryPersistence {
  const file = { written: null as string | null }
  return {
    get written(): string | null { return file.written },
    set written(value: string | null) { file.written = value },
    read: async () => file.written,
    write: async (raw) => { file.written = raw },
  }
}

/** 内存持久化工厂:按 sessionId 存独立文件;reads 与 persistenceFor 同源(懒建)。 */
function memoryFactory(): { persistenceFor(sessionId: string): MemoryPersistence } {
  const files = new Map<string, MemoryPersistence>()
  return {
    persistenceFor: (sessionId) => {
      let file = files.get(sessionId)
      if (file === undefined) {
        file = memoryPersistence()
        files.set(sessionId, file)
      }
      return file
    },
  }
}

const probeNone = { isCommitted: async () => false }

describe('RecordStore', () => {
  it('folds events and assembles internal entries from the session log', () => {
    const { persistenceFor } = memoryFactory()
    const store = new RecordStore(persistenceFor, 0)
    store.ensure('s1', probeNone)
    store.fold('s1', [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' } },
    ])
    store.observe('s1', [change('a.txt')], 1500)
    const records = store.assemble('s1', {
      changes: [change('a.txt')], repoRoot: '/repo', presenter: undefined,
      mtimes: undefined, now: 2000, subagentWrites: new Map(),
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.internal.map((e) => e.path)).toEqual(['a.txt'])
  })

  it('restores persisted observations with reconcile probe (committed paths)', async () => {
    const { persistenceFor } = memoryFactory()
    const persisted: PathObservation[] = [
      { path: 'done.ts', status: 'modified', firstSeenAt: 1000, lastSeenAt: null, committedAt: null },
      { path: 'gone.ts', status: 'modified', firstSeenAt: 1100, lastSeenAt: null, committedAt: null },
    ]
    persistenceFor('s1').written = encodeObservations(persisted)
    const store = new RecordStore(persistenceFor, 0)
    const probed = new Set<string>()
    store.ensure('s1', {
      isCommitted: async (path) => { probed.add(path); return path === 'done.ts' },
    })
    // 等待后台恢复落定(微任务冲洗)。
    await new Promise((resolve) => setTimeout(resolve, 10))
    store.fold('s1', [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'tool/call', seq: 2, time: 1100, data: { turn: 1, callId: 'c1', name: 'edit', arguments: '{"file_path":"x.ts"}' } },
    ])
    const records = store.assemble('s1', {
      changes: [], repoRoot: '/repo', presenter: undefined,
      mtimes: undefined, now: 3000, subagentWrites: new Map(),
    })
    expect(probed).toEqual(new Set(['done.ts', 'gone.ts']))
    // done.ts 经探针标注 committed;gone.ts 无提交证据 → 中性待定(gone,非断言已还原)。
    expect(records[0]?.external.find((e) => e.path === 'done.ts')?.state).toBe('committed')
    expect(records[0]?.external.find((e) => e.path === 'gone.ts')?.state).toBe('gone')
  })

  it('caps the reconcile probe at RECONCILE_PROBE_CAP', async () => {
    const { persistenceFor } = memoryFactory()
    const persisted: PathObservation[] = Array.from({ length: RECONCILE_PROBE_CAP + 10 }, (_, index) => ({
      path: `f${index}.ts`, status: 'modified' as const, firstSeenAt: 100, lastSeenAt: 200, committedAt: null,
    }))
    persistenceFor('s1').written = encodeObservations(persisted)
    const store = new RecordStore(persistenceFor, 0)
    let calls = 0
    store.ensure('s1', { isCommitted: async () => { calls += 1; return false } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toBe(RECONCILE_PROBE_CAP)
  })

  it('persists observations with debounce and rewrites on flush', async () => {
    const { persistenceFor } = memoryFactory()
    const store = new RecordStore(persistenceFor, 5)
    store.ensure('s1', probeNone)
    store.observe('s1', [change('a.ts')], 1000)
    store.flush('s1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const raw = persistenceFor('s1').written
    expect(raw).not.toBeNull()
    expect(raw ?? '').toContain('"p":"a.ts"')
    // 再次变更 → flush 覆盖
    store.observe('s1', [change('a.ts'), change('b.ts')], 2000)
    store.flush('s1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(persistenceFor('s1').written ?? '').toContain('"p":"b.ts"')
  })

  it('disposeSession flushes and releases state', async () => {
    const { persistenceFor } = memoryFactory()
    const store = new RecordStore(persistenceFor, 0)
    store.ensure('s1', probeNone)
    store.observe('s1', [change('a.ts')], 1000)
    store.disposeSession('s1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(persistenceFor('s1').written).toContain('"p":"a.ts"')
    expect(store.has('s1')).toBe(false)
  })

  it('tracks head advances and resolves commit paths', async () => {
    const { persistenceFor } = memoryFactory()
    const store = new RecordStore(persistenceFor, 0)
    store.ensure('s1', probeNone)
    store.fold('s1', [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    ])
    store.observe('s1', [change('a.ts')], 1000)
    let resolved: [string, string] | null = null
    await store.noteHead('s1', 'aaa1111', 1500, (from, to) => {
      resolved = [from, to]
      return ['a.ts']
    })
    expect(resolved).toBeNull() // 首次记录:无前值,不触发
    await store.noteHead('s1', 'bbb2222', 2000, (from, to) => {
      resolved = [from, to]
      return ['a.ts']
    })
    expect(resolved).toEqual(['aaa1111', 'bbb2222'])
    const records = store.assemble('s1', {
      changes: [], repoRoot: '/repo', presenter: undefined,
      mtimes: undefined, now: 3000, subagentWrites: new Map(),
    })
    expect(records[0]?.external[0]).toMatchObject({ path: 'a.ts', state: 'committed' })
    // 同 head 幂等
    await store.noteHead('s1', 'bbb2222', 2500, () => { throw new Error('should not run') })
  })

  it('fails silently when persistence read/write throws', async () => {
    const failing = {
      persistenceFor: () => ({
        read: async () => { throw new Error('io') },
        write: async () => { throw new Error('io') },
      }),
    }
    const store = new RecordStore(failing.persistenceFor, 0)
    store.ensure('s1', probeNone)
    await new Promise((resolve) => setTimeout(resolve, 10))
    store.fold('s1', [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    ])
    store.observe('s1', [change('a.ts')], 1000)
    store.flush('s1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // 不抛错、内存态保留(可继续读记录)。
    const records = store.assemble('s1', {
      changes: [change('a.ts')], repoRoot: '/repo', presenter: undefined,
      mtimes: undefined, now: 2000, subagentWrites: new Map(),
    })
    expect(records[0]?.external).toHaveLength(1)
  })
})