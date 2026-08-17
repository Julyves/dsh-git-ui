/**
 * IDEA 式时间格式化测试：分钟前/今天/昨天/绝对日期四档。
 */
import { describe, expect, it } from 'vitest'
import { formatWhen } from '../../src/client/time-format.ts'

const labels = {
  minutesAgo: (n: number) => `${n} 分钟前`,
  today: '今天',
  yesterday: '昨天',
}

/** 固定“现在”：本地 2026-08-17 15:30。 */
const NOW = new Date(2026, 7, 17, 15, 30, 0).getTime()

describe('formatWhen', () => {
  it('renders minutes ago within one hour', () => {
    const iso = new Date(2026, 7, 17, 15, 6, 0).toISOString()
    expect(formatWhen(iso, NOW, labels)).toBe('24 分钟前')
  })

  it('renders today HH:mm for earlier the same day', () => {
    const iso = new Date(2026, 7, 17, 9, 5, 0).toISOString()
    expect(formatWhen(iso, NOW, labels)).toBe('今天 09:05')
  })

  it('renders yesterday HH:mm for the previous calendar day', () => {
    const iso = new Date(2026, 7, 16, 22, 3, 0).toISOString()
    expect(formatWhen(iso, NOW, labels)).toBe('昨天 22:03')
  })

  it('renders absolute Y/M/D HH:mm otherwise', () => {
    const iso = new Date(2026, 7, 10, 15, 16, 0).toISOString()
    expect(formatWhen(iso, NOW, labels)).toBe('2026/8/10 15:16')
  })

  it('falls back to the raw string for invalid dates', () => {
    expect(formatWhen('not-a-date', NOW, labels)).toBe('not-a-date')
  })
})
