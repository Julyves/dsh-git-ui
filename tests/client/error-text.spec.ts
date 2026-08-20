/**
 * 操作错误友好化单元测试：可预期业务错误（切分支被本地变更阻止）映射
 * i18n 友好文案 + 行动引导；其余错误回退原始 git 信息。
 */
import { describe, expect, it } from 'vitest'
import { errorText, errorAction } from '../../src/client/error-text.ts'
import { zh, type GitKey } from '../../src/client/locales.ts'

const t = (key: GitKey): string => zh[key]

describe('errorText', () => {
  it('maps a local-changes-block error to the friendly localized copy', () => {
    expect(errorText('local-changes-block', 'raw git stderr', t)).toBe(zh['error.localChangesBlock'])
  })

  it('falls back to the raw message or code for unknown errors', () => {
    expect(errorText('git-error', 'fatal: refuse to merge', t)).toBe('fatal: refuse to merge')
    expect(errorText('git-error', undefined, t)).toBe('git-error')
    expect(errorText('invalid-name', 'invalid branch name', t)).toBe('invalid branch name')
  })
})

describe('errorAction', () => {
  it('suggests open-center only for local-changes-block', () => {
    expect(errorAction('local-changes-block')).toBe('open-center')
    expect(errorAction('git-error')).toBeNull()
    expect(errorAction('timeout')).toBeNull()
  })
})