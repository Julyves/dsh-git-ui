/**
 * 设置 React 绑定层：useSettings 订阅钩子。
 *
 * 与 store 分离的动机：store 是纯逻辑（可在 node 环境单测），
 * React hook 是绑定层（仅浏览器组件消费）。
 */
import { useSyncExternalStore } from 'react'
import type { GitUISettings } from '../../contracts/settings.ts'
import { settingsStore } from './store.ts'

/** React 订阅钩子：读取设置并订阅变更（useSyncExternalStore 形状）。 */
export function useSettings(): GitUISettings {
  return useSyncExternalStore(
    (listener) => settingsStore.subscribe(listener),
    () => settingsStore.get(),
  )
}
