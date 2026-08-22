/**
 * 插件激活逻辑：纯业务编排，零框架依赖。
 *
 * 接收 `ClientPlatform` 接口和插件依赖，完成：
 *   1. 注册国际化字典
 *   2. 挂载 Remote 并获取 gitInfo 服务
 *   3. 注册 header utility slot
 *   4. 订阅连接重置事件
 *
 * 适配层（如 `adapters/dsh/client-adapter.ts`）负责将宿主 API 翻译为
 * `ClientPlatform`，然后调用本函数。业务层对宿主一无所知。
 */
import type { ClientPlatform, SlotEntryDescriptor, GitInjected, GitRemoteLike } from './client-platform.ts'
import type { RemoteContribution } from './client-platform.ts'
import type { LocaleDicts } from './client-platform.ts'
import type { GitAction } from '../host/types.ts'
import type { GitQueryRequest, GitActionResult } from '../host/types.ts'
import type { GitQueryOutcome } from './client-platform.ts'

/** Slot 名称常量。 */
const HEADER_UTILITIES_SLOT = 'conversation.session.header.utilities'

/** 本插件的 slot 条目 ID。 */
const SLOT_ENTRY_ID = 'git'

/** 国际化命名空间。 */
const LOCALE_NS = 'git'

/** 控制器接口：插件激活逻辑依赖的控制器能力。 */
export interface ControllerLike {
  subscribe(listener: () => void): () => void
  getSnapshot(): import('./client-platform.ts').GitView
  refresh(): Promise<void>
  resync(): void
  run(action: GitAction): Promise<GitActionResult>
  query(query: GitQueryRequest['query']): Promise<GitQueryOutcome>
  dispose(): void
}

/** 插件依赖：由调用方提供的具体实现。 */
export interface PluginDependencies {
  /** Remote 贡献配置 */
  remoteContribution: RemoteContribution
  /** 国际化字典 */
  locales: LocaleDicts
  /** 控制器构造函数 */
  createController: (remote: GitRemoteLike, sessionId: string) => ControllerLike
}

/**
 * 激活插件。
 *
 * @param platform 宿主平台能力
 * @param deps 插件依赖（由调用方提供）
 * @param component 要注册的 UI 组件（已包裹 UI 基础组件上下文）
 * @returns gitInfo Remote 服务句柄（供调用方做设置持久化等初始化）
 */
export async function activatePlugin(
  platform: ClientPlatform,
  deps: PluginDependencies,
  component: unknown,
): Promise<GitRemoteLike> {
  // 1. 注册国际化字典
  platform.effect(
    () => platform.registerLocale(LOCALE_NS, deps.locales),
    'dsh-git-ui: dictionaries',
  )

  // 2. 挂载 Remote 并获取 gitInfo 服务
  const gitInfoService = await platform.mountRemoteAndGetService(deps.remoteContribution, 'gitInfo')

  // 3. 控制器缓存（按 sessionId）
  const controllers = new Map<string, ControllerLike>()
  const faces = new Map<string, GitInjected>()

  const controllerFor = (sessionId: string): ControllerLike => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = deps.createController(gitInfoService, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  // 4. 注册 slot 条目
  const slotOptions: SlotEntryDescriptor = {
    name: HEADER_UTILITIES_SLOT,
    id: SLOT_ENTRY_ID,
    order: 10,
    locale: LOCALE_NS,
    inject: (sessionId): GitInjected => {
      // Per-session stable face: the slot runtime may re-invoke the
      // inject factory on every render, and components depend on the
      // `refresh` reference staying stable (a fresh arrow function per
      // call would re-run mount effects and loop: refresh → view
      // change → re-render → new refresh → refresh …). Cache the face
      // so the same controller (and its bound refresh/run) is always
      // handed out per session.
      let face = faces.get(sessionId)
      if (face === undefined) {
        const controller = controllerFor(sessionId)
        face = {
          hooks: { git: controller as GitInjected['hooks']['git'] },
          refresh: () => controller.refresh(),
          run: (action) => controller.run(action),
          query: (query) => controller.query(query),
        }
        faces.set(sessionId, face)
      }
      return face
    },
  }

  const disposeSlot = platform.registerSlotEntry(slotOptions, component)

  // 5. 注册清理：释放 slot 并销毁全部控制器
  platform.effect(() => {
    return () => {
      disposeSlot()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
      faces.clear()
    }
  }, 'dsh-git-ui: slot and controller lifecycle')

  // 6. 订阅连接重置事件：重连后刷新全部控制器
  platform.onEvent('connection/reset', () => {
    for (const controller of controllers.values()) controller.resync()
  })

  return gitInfoService
}
