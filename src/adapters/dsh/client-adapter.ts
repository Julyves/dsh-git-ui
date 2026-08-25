/**
 * dsh Client 平台适配：将 Cordis Context 翻译为 `ClientPlatform` 接口。
 *
 * 本文件是 client 端**唯一**知道 Cordis / typert 插件生命周期的地方。
 * dsh 升级导致插件 API 变更时，只需修改此文件。
 *
 * 关键适配点：
 *   - `mountRemoteAndGetService`：处理 typert Remote 挂载 + Cordis child fiber
 *   - `registerSlotEntry`：翻译 slot 注册两步模式（inject + register）
 *   - `onEvent` / `effect`：直接映射 Cordis 同名方法
 */
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientPlatform, LocaleDicts, RemoteContribution, GitInjected, GitRemoteLike } from '../../contracts/client-platform.ts'

/**
 * Cordis Context 的结构化切片。
 *
 * 只声明本适配器实际使用的属性和方法。dsh 升级时若 API 变更，
 * 只需更新此接口和下方的适配实现。
 */
export interface DshClientContext {
  /** 订阅应用事件（自动在 fiber 卸载时清理）。 */
  on(event: string, listener: (...args: never[]) => void): (() => void) | void
  /** 注册副作用（自动在 fiber 卸载时清理）。 */
  effect(callback: () => void | (() => void | Promise<void>), label?: string): void
  /** 启动一个嵌套插件 fiber（子上下文）。 */
  plugin(definition: {
    readonly name: string
    readonly inject: readonly string[]
    apply: (ctx: DshClientContext) => void | Promise<void>
  }): Promise<unknown>
  /** Remote 服务：挂载贡献 + 访问已挂载的命名空间。 */
  remote: {
    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
    gitInfo: GitRemoteLike
  }
  /** Slot 注册表。 */
  slots: {
    inject(slotName: string, provider: () => (() => void) | void): void
    register(
      options: {
        readonly name: string
        readonly id: string
        readonly order?: number
        readonly locale?: string
        readonly inject: (sessionId: string) => GitInjected
      },
      component: unknown,
    ): () => void
  }
  /** 国际化服务。 */
  locale: {
    register(namespace: string, dictionaries: LocaleDicts): void
  }
}

/**
 * 将我们的 `RemoteContribution` 转换为 dsh 的 `TypertRemoteContribution`。
 *
 * 当前两者结构相同（字段一一对应），直接透传。若未来 typert 协议变更，
 * 在此处做字段映射。
 */
function toTypertContribution(ours: RemoteContribution): TypertRemoteContribution {
  return ours as TypertRemoteContribution
}

/**
 * 将 Cordis Context 适配为 `ClientPlatform`。
 *
 * `mountRemoteAndGetService` 必须通过 child fiber 访问命名空间服务：
 * Cordis 的访问控制要求读取 `remote.gitInfo` 前必须在 inject 中声明它，
 * 而主 fiber 不能声明（服务由我们自己的 apply 挂载，声明会死锁——
 * cordis 会等待 apply 执行后才存在的服务）。child fiber 在 mount 之后
 * 激活，声明 `remote.gitInfo` 时服务已存在——无等待、无访问违规。
 */
export function adaptDshClientContext(ctx: DshClientContext): ClientPlatform {
  return {
    registerLocale(namespace, dicts) {
      ctx.locale.register(namespace, dicts)
    },

    async mountRemoteAndGetService(contribution, namespace) {
      // 挂载 Remote 贡献（主 fiber 内执行，仅调用 $mount 方法本身）
      await ctx.remote.$mount(toTypertContribution(contribution))
      if (namespace !== 'gitInfo') {
        throw new Error(`adaptDshClientContext: 未知命名空间 "${namespace}"`)
      }
      // child fiber：inject 声明 remote.gitInfo，apply 内读取合法
      let service: GitRemoteLike | undefined
      await ctx.plugin({
        name: 'dsh-git-ui:git',
        inject: ['remote.gitInfo'],
        apply: (sub) => {
          service = sub.remote.gitInfo
        },
      })
      if (service === undefined) {
        throw new Error('adaptDshClientContext: gitInfo 服务未就绪')
      }
      return service
    },

    registerSlotEntry(options, component) {
      // Cordis slot 注册是两步模式：inject + register
      // inject 注册一个 provider 工厂，register 在 provider 内调用
      let disposeRegister: (() => void) | undefined
      ctx.slots.inject(options.name, () => {
        disposeRegister = ctx.slots.register(
          {
            name: options.name,
            id: options.id,
            order: options.order,
            locale: options.locale,
            inject: options.inject,
          },
          component,
        )
        return () => {
          disposeRegister?.()
        }
      })
      // 返回释放函数：调用时注销 slot 条目
      return () => {
        disposeRegister?.()
      }
    },

    onEvent(event, listener) {
      return ctx.on(event, listener as (...args: never[]) => void)
    },

    effect(callback, label) {
      ctx.effect(callback, label)
    },
  }
}
