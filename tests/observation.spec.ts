import { describe, expect, it } from 'vitest'
import { ObservationLog, OBSERVATION_CAP } from '../src/host/observation.ts'
import type { GitChange } from '../src/host/types.ts'

function change(path: string, status: GitChange['status'] = 'modified'): GitChange {
  return { path, status, staged: false, isDirectory: false }
}

async function manyChanges(count: number): Promise<GitChange[]> {
  return Array.from({ length: count }, (_, index) => change(`f${String(index).padStart(4, '0')}.ts`))
}

describe('ObservationLog', () => {
  it('records firstSeen on first sight and keeps lastSeen null while present', () => {
    const log = new ObservationLog()
    log.update([change('a.ts')], 1000)
    expect(log.get('a.ts')).toEqual({ path: 'a.ts', status: 'modified', firstSeenAt: 1000, lastSeenAt: null, committedAt: null })
    log.update([change('a.ts')], 2000)
    expect(log.get('a.ts')?.lastSeenAt).toBeNull()
    expect(log.get('a.ts')?.firstSeenAt).toBe(1000)
  })

  it('marks lastSeen when a path leaves the changes', () => {
    const log = new ObservationLog()
    log.update([change('a.ts')], 1000)
    log.update([], 2000)
    expect(log.get('a.ts')?.lastSeenAt).toBe(2000)
    log.update([change('a.ts')], 3000) // 重新出现:lastSeen 清零,firstSeen 保留
    expect(log.get('a.ts')).toMatchObject({ firstSeenAt: 1000, lastSeenAt: null })
  })

  it('skips disappearance judgement when truncated (avoids false lastSeen)', () => {
    const log = new ObservationLog()
    log.update([change('a.ts')], 1000)
    log.update([], 2000, true)
    expect(log.get('a.ts')?.lastSeenAt).toBeNull()
  })

  it('keeps status fresh and marks commits', () => {
    const log = new ObservationLog()
    log.update([change('a.ts', 'modified')], 1000)
    log.update([change('a.ts', 'added')], 2000)
    expect(log.get('a.ts')?.status).toBe('added')
    log.markCommitted(['a.ts'], 3000)
    expect(log.get('a.ts')?.committedAt).toBe(3000)
    log.markCommitted(['a.ts'], 4000) // 幂等:不覆盖已标注
    expect(log.get('a.ts')?.committedAt).toBe(3000)
  })

  it('prunes to the cap by oldest firstSeenAt', async () => {
    const log = new ObservationLog()
    const changes = await manyChanges(OBSERVATION_CAP + 20)
    log.update(changes, 1000)
    expect(log.entries()).toHaveLength(OBSERVATION_CAP)
    // 最旧的 20 条被裁剪,最新的保留
    expect(log.get('f0000.ts')).toBeUndefined()
    expect(log.get('f0019.ts')).toBeUndefined()
    expect(log.get('f0020.ts')).toBeDefined()
  })

  it('restore replaces the whole log and validates paths', () => {
    const log = new ObservationLog()
    log.update([change('a.ts')], 1000)
    log.restore([
      { path: 'b.ts', status: 'modified', firstSeenAt: 500, lastSeenAt: null, committedAt: null },
      { path: '../evil.ts', status: 'modified', firstSeenAt: 500, lastSeenAt: null, committedAt: null },
    ])
    expect(log.entries()).toHaveLength(1)
    expect(log.get('b.ts')).toBeDefined()
    expect(log.get('a.ts')).toBeUndefined()
  })

  it('works without a persistence channel (in-memory only)', () => {
    const log = new ObservationLog()
    log.update([change('a.ts')], 1000)
    expect(log.serialize()).toHaveLength(1)
  })
})