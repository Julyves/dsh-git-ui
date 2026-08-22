/**
 * 高亮就绪 React 绑定层（安全订阅模式）。
 *
 * 与 useSettings 同款实现（不用 useSyncExternalStore）：
 * useEffect + useState + subscribe——在所有 React 版本、DSH 宿主
 * 自定义渲染管线中稳定。构造完成前组件渲染纯文本；就绪后重渲染着色。
 */
import { useEffect, useState } from 'react'
import { highlightReadyCount, subscribeHighlightReady } from './highlighter.ts'

/** 订阅高亮构造完成计数（跨渲染稳定标识）。 */
export function useHighlightReady(): number {
  const [count, setCount] = useState<number>(() => highlightReadyCount())

  useEffect(() => {
    // 订阅就绪通知；初始值已由 useState 读取。
    const unsubscribe = subscribeHighlightReady(() => {
      setCount(highlightReadyCount())
    })
    // 挂载时检查渲染期间是否已就绪（异步构造可能在订阅前完成）。
    const current = highlightReadyCount()
    if (current !== count) setCount(current)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount 一次
  }, [])

  return count
}
