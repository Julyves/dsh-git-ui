/**
 * UI 基础组件 React Context：业务组件通过 `useUI()` 获取实现，
 * 适配层在插件激活时通过 `<UIPrimitivesProvider>` 注入宿主组件。
 *
 * 设计要点：
 *   - 默认值为 null——若未提供则 `useUI()` 抛出明确错误，而非静默渲染空组件。
 *   - Provider 在插件入口（client/index.ts）包裹整棵组件树。
 *   - 测试可直接用 Provider 注入 mock 组件，无需模拟宿主环境。
 */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { UIPrimitives } from './ui-primitives.ts'

const UIPrimitivesContext = createContext<UIPrimitives | null>(null)

/** 消费 UI 基础组件。必须在 `<UIPrimitivesProvider>` 内使用。 */
export function useUI(): UIPrimitives {
  const value = useContext(UIPrimitivesContext)
  if (value === null) {
    throw new Error('useUI(): missing <UIPrimitivesProvider> — 插件入口未注入 UI 基础组件')
  }
  return value
}

/** 注入 UI 基础组件实现。在插件入口包裹整棵组件树。 */
export function UIPrimitivesProvider({ value, children }: { value: UIPrimitives; children?: ReactNode }): ReactNode {
  return <UIPrimitivesContext.Provider value={value}>{children}</UIPrimitivesContext.Provider>
}
