/**
 * Turn 记录获取 hook:以 `snapshot.checkedAt` 为刷新键拉取 turn-records。
 *
 * 每次轮询/手动刷新/操作后快照更新 → checkedAt 变化 → 重拉;
 * 拉取失败(会话不可用等)→ failed 置位,pill 静默隐藏徽章、中心 Tab
 * 显示降级文案——与「确定降级」传统一致。
 */
import { useEffect, useState } from 'react'
import type { GitQueryOutcome } from './controller.ts'
import type { TurnWorkRecord } from '../host/types.ts'

export interface TurnRecordsState {
  readonly records: readonly TurnWorkRecord[] | null
  readonly failed: boolean
}

/**
 * @param query 现有 query 注入面(turn-records 经 host 编排层返回)
 * @param refreshKey 快照检查时刻(checkedAt);变化即重拉;负值 = 禁用
 *   (设置关闭等场景不发起任何查询)
 */
export function useTurnRecords(
  query: (q: { readonly kind: 'turn-records' }) => Promise<GitQueryOutcome>,
  refreshKey: number,
): TurnRecordsState {
  const [records, setRecords] = useState<readonly TurnWorkRecord[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (refreshKey < 0) return // 禁用:不拉取(设置关闭等)。
    let cancelled = false
    setFailed(false)
    void query({ kind: 'turn-records' }).then((outcome) => {
      if (cancelled) return
      if (outcome.ok && outcome.value.kind === 'turn-records') {
        setRecords(outcome.value.turns)
      } else {
        setFailed(true)
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query 为稳定契约;仅随刷新键重拉。
  }, [refreshKey])

  return { records, failed }
}