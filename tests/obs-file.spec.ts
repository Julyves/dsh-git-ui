import { describe, expect, it } from 'vitest'
import { decodeObservations, encodeObservations, sessionStorageKey } from '../src/host/obs-file.ts'
import type { PathObservation } from '../src/host/observation.ts'

const sample: readonly PathObservation[] = [
  { path: 'src/a.ts', status: 'modified', firstSeenAt: 1000, lastSeenAt: null, committedAt: null, commitHash: null, author: null },
  { path: 'docs/new.md', status: 'untracked', firstSeenAt: 2000, lastSeenAt: 2500, committedAt: 2600, commitHash: null, author: null },
]

describe('encode/decode observations', () => {
  it('round-trips entries through JSONL', () => {
    const raw = encodeObservations(sample)
    expect(raw.split('\n')[0]).toBe('v1')
    const decoded = decodeObservations(raw)
    expect(decoded).toEqual(sample)
  })

  it('returns null when the version header is missing or wrong', () => {
    expect(decodeObservations('v0\n')).toBeNull()
    expect(decodeObservations('')).toBeNull()
    expect(decodeObservations('{"p":"a"}')).toBeNull()
  })

  it('skips malformed rows but keeps valid ones', () => {
    const raw = [
      'v1',
      '{"p":"a.ts","s":"modified","f":1,"l":null,"c":null}',
      '{not json',
      '{"p":"","s":"modified","f":1,"l":null,"c":null}',
      '{"p":"b.ts","s":"bogus-status","f":1,"l":null,"c":null}',
    ].join('\n')
    expect(decodeObservations(raw)).toEqual([
      { path: 'a.ts', status: 'modified', firstSeenAt: 1, lastSeenAt: null, committedAt: null, commitHash: null, author: null },
    ])
  })

  it('caps the encoded entry count', () => {
    const many = Array.from({ length: 5000 }, (_, index): PathObservation => ({
      path: `f${index}.ts`, status: 'modified', firstSeenAt: index, lastSeenAt: null, committedAt: null, commitHash: null, author: null,
    }))
    const raw = encodeObservations(many)
    expect(decodeObservations(raw)).toHaveLength(2000)
  })
})

describe('sessionStorageKey', () => {
  it('passes valid ids through untouched', () => {
    expect(sessionStorageKey('session-1')).toBe('session-1')
    expect(sessionStorageKey('session_2')).toBe('session_2')
  })

  it('sanitizes invalid chars and appends a stable fingerprint', () => {
    const key = sessionStorageKey('my session/2026!')
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)).toBe(true)
    expect(key).toContain('-')
    expect(sessionStorageKey('my session/2026!')).toBe(key) // 确定性强
    expect(key).not.toBe(sessionStorageKey('my-session/2026!')) // 不同输入不同键
  })

  it('handles fully-invalid ids with a fingerprint-only name', () => {
    const key = sessionStorageKey('!!!')
    expect(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)).toBe(true)
    expect(sessionStorageKey('!!!')).toBe(key)
  })
})
describe('observations author field (v1 兼容)', () => {
  it('round-trips the sibling author marker', () => {
    const entries: readonly PathObservation[] = [
      { path: 'sib.ts', status: 'modified', firstSeenAt: 1, lastSeenAt: null, committedAt: null, commitHash: null, author: 'sibling' },
      { path: 'own.ts', status: 'modified', firstSeenAt: 1, lastSeenAt: null, committedAt: null, commitHash: null, author: null },
    ]
    const decoded = decodeObservations(encodeObservations(entries)) ?? []
    expect(decoded.find((e) => e.path === 'sib.ts')?.author).toBe('sibling')
    expect(decoded.find((e) => e.path === 'own.ts')?.author).toBeNull()
  })

  it('decodes v1 rows without the author field as null (backward compatible)', () => {
    const raw = ['v1', '{"p":"old.ts","s":"modified","f":1,"l":null,"c":null,"h":null}'].join('\n')
    const decoded = decodeObservations(raw)
    expect(decoded?.[0]?.author).toBeNull()
  })
})
