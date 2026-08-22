/**
 * 设置 React 绑定层：useSettings 订阅钩子。
 *
 * 兼容实现：不使用 useSyncExternalStore（React 18+ 专用 API），
 * 改用 useEffect + useState + subscribe 模式——在所有 React 版本、
 * SSR/hydration 环境、DSH 宿主自定义渲染管线中均稳定。
 *
 * 与 store 分离的动机：store 是纯逻辑（可在 node 环境单测），
 * React hook 是绑定层（仅浏览器组件消费）。
 */
import { useEffect, useState } from 'react'
import type { GitUISettings } from '../../contracts/settings.ts'
import { settingsStore } from './store.ts'

/** React 订阅钩子：读取设置并订阅变更。 */
export function useSettings(): GitUISettings {
  const [settings, setSettings] = useState<GitUISettings>(() => settingsStore.get())

  useEffect(() => {
    // 订阅 store 变更；初始值已由 useState 初始化读取，无需重复。
    const unsubscribe = settingsStore.subscribe(() => {
      setSettings(settingsStore.get())
    })
    // 挂载时检查是否在渲染期间被其他组件修改了设置（如设置 Tab 重置）。
    const current = settingsStore.get()
    if (current !== settings) setSettings(current)
    return unsubscribe
    // settings 引用在此闭包中是初始值——useEffect 只在 mount 时跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return settings
}
