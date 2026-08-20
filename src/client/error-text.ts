import type { GitKey } from './locales.ts'
import type { GitOperationErrorCode } from '../host/types.ts'

/**
 * 操作错误 → 展示文案。可预期的业务错误（如切换分支被未提交变更阻止）
 * 映射本地化友好文案；其余错误回退原始 git message（无 message 时用 code）。
 * 原始信息由调用方经 errorTextDetail 保留，供 title 等按需展示。
 */
export function errorText(code: GitOperationErrorCode, message: string | undefined, t: (key: GitKey) => string): string {
  switch (code) {
    case 'local-changes-block':
      return t('error.localChangesBlock')
    default:
      return message ?? code
  }
}

/** 该错误是否应附带「处理变更」行动（打开 Git 中心变更页）。 */
export function errorAction(code: GitOperationErrorCode): 'open-center' | null {
  return code === 'local-changes-block' ? 'open-center' : null
}