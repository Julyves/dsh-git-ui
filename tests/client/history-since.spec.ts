/**
 * 历史时间过滤哨兵解析测试（「今天 ≠ 24 小时内」bug 修复回归）。
 *
 * 根因：旧实现「今天」直接发送 git 相对表达 `1 day ago`（当前时刻减 24h），
 * 昨天晚间的提交被算进「今天」。修复后 `@today` 解析为**本地当日零点**的
 * ISO 串；新增 `@24h` 选项承载原 24 小时语义。
 */
import { describe, expect, it } from 'vitest'
import { resolveSince } from '../../src/client/center/shared.ts'

describe('resolveSince — since 哨兵解析', () => {
  it('@today → 本地当日零点（ISO，秒精度）', () => {
    const iso = resolveSince('@today', new Date(2026, 7, 27, 15, 42, 30)) // 2026-08-27 15:42 本地
    expect(iso).toBe('2026-08-27T00:00:00')
  })

  it('核心回归：今天 00:30 查询，昨天 23:59 的提交不在 --since 界内', () => {
    // 本地 8 月 27 日 00:30 选「今天」→ 边界 = 8 月 27 日 00:00；
    // 昨天（8 月 26 日）任何时刻都在界外——旧实现（now-24h=26 日 00:30）会把
    // 26 日 00:30 之后的提交（含 23:59）错误纳入。
    const since = resolveSince('@today', new Date(2026, 7, 27, 0, 30))
    expect(since).toBe('2026-08-27T00:00:00')
    expect(new Date(since).getTime()).toBeGreaterThan(new Date(2026, 7, 26, 23, 59).getTime())
  })

  it('跨零点：注入的 now 过了午夜 → 解析值跟随新一天（缓存键随之变化）', () => {
    const before = resolveSince('@today', new Date(2026, 7, 27, 23, 59))
    const after = resolveSince('@today', new Date(2026, 7, 28, 0, 1))
    expect(before).toBe('2026-08-27T00:00:00')
    expect(after).toBe('2026-08-28T00:00:00')
  })

  it('相对档位透传 git 相对表达；空串 = 全部时间；未知哨兵安全回落空串', () => {
    expect(resolveSince('@24h')).toBe('24 hours ago')
    expect(resolveSince('@7d')).toBe('7 days ago')
    expect(resolveSince('@30d')).toBe('30 days ago')
    expect(resolveSince('@90d')).toBe('90 days ago')
    expect(resolveSince('')).toBe('')
    expect(resolveSince('@bogus')).toBe('')
  })

  it('零点解析不含时区偏移字面量——按本地时间交给 git（本机时区语义）', () => {
    // 语义锚点：@today 的 ISO 串不带 Z/偏移后缀，git 按本地时区解读。
    const iso = resolveSince('@today', new Date(2026, 0, 2, 8, 0))
    expect(iso).toBe('2026-01-02T00:00:00')
    expect(iso.endsWith('Z')).toBe(false)
  })
})
