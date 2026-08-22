/**
 * dsh-git-ui client 入口：Cordis 约定字段 + 委托。
 *
 * 导出 Cordis 插件约定字段（`inject` / `name` / `apply`）；`apply` 内部
 * 将 Cordis Context 适配为 `ClientPlatform` 接口后委托给纯业务函数。
 * dsh 适配逻辑在 `adapters/dsh/client-adapter.ts`。
 */
import { createElement, type ReactNode } from 'react'
import { GitPill, type GitPillProps } from './GitPill.tsx'
import { UIPrimitivesProvider } from '../contracts/ui-context.tsx'
import { dshUIPrimitives } from '../adapters/dsh/ui-primitives.ts'
import { adaptDshClientContext, type DshClientContext } from '../adapters/dsh/client-adapter.ts'
import { activatePlugin, type PluginDependencies } from '../contracts/plugin-activation.ts'
import { GitController } from './controller.ts'
import { gitInfoRemote } from './remote.ts'
import { en, zh } from './locales.ts'
import { hostPersistence, settingsStore } from './settings/store.ts'

/**
 * Cordis 插件约定：声明需要的服务。
 *
 * `remote.gitInfo` 不在此列出——它由我们自己的 apply 挂载，
 * 若在 inject 中声明会导致死锁（服务在 apply 执行后才存在）。
 */
export const inject = ['slots', 'remote', 'locale'] as const

/** 插件标识。 */
export const name = 'dsh-git-ui'

/** 插件入口使用的 UI 基础组件实现（dsh 宿主提供）。 */
const uiPrimitives = dshUIPrimitives

/** 包裹 GitPill，注入 UI 基础组件上下文。 */
function GitPillWithUI(props: GitPillProps): ReactNode {
  return createElement(UIPrimitivesProvider, { value: uiPrimitives }, createElement(GitPill, props))
}

/**
 * Cordis 插件入口：适配 Context 后委托给纯业务函数。
 *
 * dsh 升级导致插件 API 变更时，只需更新 `adapters/dsh/client-adapter.ts`
 * 中的 `DshClientContext` 接口和 `adaptDshClientContext` 实现。
 */
export async function apply(ctx: DshClientContext): Promise<void> {
  const platform = adaptDshClientContext(ctx)
  
  // 提供插件依赖
  const deps: PluginDependencies = {
    remoteContribution: gitInfoRemote,
    locales: { zh, en },
    createController: (remote, sessionId) => new GitController(remote, sessionId),
  }
  
  const remote = await activatePlugin(platform, deps, GitPillWithUI)

  // 设置持久化初始化：host 磁盘（~/.dsh/plugin-data/dsh-git-ui/settings.json）
  // 优先；缺失时从 v1 localStorage 迁移。失败静默保持内存默认。
  void settingsStore.initialize(hostPersistence(remote)).catch(() => {})
}
