/**
 * Client 插件平台契约：业务层定义「我需要宿主做什么」，适配层实现「宿主怎么做」。
 *
 * 当 dsh 升级导致 Cordis / typert / slot API 变更时，只需更新
 * `adapters/dsh/client-adapter.ts`，本文件及业务代码零改动。
 */
import type { GitAction, GitActionResult, GitActionRequest, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult } from '../host/types.ts'

/** 国际化字典：中英双语。 */
export interface LocaleDicts {
  readonly zh: Record<string, string>
  readonly en: Record<string, string>
}

/** RPC 信封：传输层结果（ok/error）包裹业务返回值。 */
export type RemoteEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string; readonly details?: unknown } }

/** Git Remote 服务接口：客户端通过此接口与宿主 RPC 通信。 */
export interface GitRemoteLike {
  snapshot(request: GitSnapshotRequest): Promise<RemoteEnvelope<GitSnapshotResult>>
  run(request: GitActionRequest): Promise<RemoteEnvelope<GitActionResult>>
  query(request: GitQueryRequest): Promise<RemoteEnvelope<GitQueryResponse>>
}

/** 简化的查询结果：解包 RPC 信封和业务错误。 */
export type GitQueryOutcome =
  | { readonly ok: true; readonly value: Extract<GitQueryResponse, { ok: true }>['value'] }
  | { readonly ok: false; readonly message: string }

/** Git 视图状态：客户端组件消费的可观察快照。 */
export type GitView =
  | { readonly state: 'no-cwd' }
  | { readonly state: 'cold' }
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly snapshot: import('../host/types.ts').GitSnapshot }
  | { readonly state: 'error'; readonly error: import('../host/types.ts').GitSnapshotFailure }

/** 可观察对象：useSyncExternalStore 形状。 */
export interface GitObservable<V> {
  subscribe(listener: () => void): () => void
  getSnapshot(): V
}

/** Slot 注入接口：组件通过此接口与控制器交互。 */
export interface GitInjected {
  hooks: {
    /** 会话的 Git 视图源。Slot 运行时将其绑定为 useGit 选择器钩子。 */
    git: GitObservable<GitView>
  }
  /** 强制立即刷新（与轮询相同路径）。 */
  refresh: () => Promise<void>
  /** 执行一条管理操作（宿主返回新快照）。 */
  run: (action: GitAction) => Promise<GitActionResult>
  /** 执行一条只读查询（历史/差异/分支等）。 */
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
}

/** Slot 条目描述符：注册到宿主 slot 系统的一条记录。 */
export interface SlotEntryDescriptor {
  /** Slot 名称（如 'conversation.session.header.utilities'）。 */
  readonly name: string
  /** 条目 ID（同一 slot 内唯一）。 */
  readonly id: string
  /** 渲染顺序（升序）。 */
  readonly order?: number
  /** 国际化命名空间。 */
  readonly locale?: string
  /** 注入工厂：每次渲染调用，返回该条目的业务接口。 */
  readonly inject: (sessionId: string) => GitInjected
}

/**
 * Client 平台能力：业务层需要的全部宿主服务。
 *
 * 设计原则：
 *   - 只声明「做什么」，不暴露「怎么做」
 *   - 方法签名取业务层实际使用的最小集
 *   - 返回类型为业务层需要的接口，非宿主原始类型
 */
export interface ClientPlatform {
  /** 注册国际化字典。 */
  registerLocale(namespace: string, dicts: LocaleDicts): void

  /**
   * 挂载 Remote 贡献并返回命名空间服务对象。
   *
   * 挂载完成后，返回的对象可用于创建业务控制器。适配层负责处理
   * 宿主的挂载机制（如 Cordis 的 child fiber + inject 模式）。
   */
  mountRemoteAndGetService(contribution: RemoteContribution, namespace: string): Promise<GitRemoteLike>

  /**
   * 注册一个 slot 条目。
   *
   * 宿主负责在合适的时机渲染该条目。返回释放函数，调用后注销条目。
   */
  registerSlotEntry(options: SlotEntryDescriptor, component: unknown): () => void

  /** 订阅应用事件。返回取消订阅函数（若宿主支持）。 */
  onEvent(event: string, listener: (...args: unknown[]) => void): (() => void) | void

  /**
   * 注册副作用。回调可返回清理函数，在插件卸载时调用。
   * 用于管理定时器等需要生命周期管理的资源。
   */
  effect(callback: () => void | (() => void | Promise<void>), label?: string): void
}

/**
 * Remote 贡献声明：描述一个命名空间下的全部 RPC 方法。
 *
 * 本接口是业务层对 RPC 声明的最小需求。适配层负责将其转换为宿主
 * 的具体格式（如 TypertRemoteContribution）。
 */
export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly RemoteMethodDescriptor[]
}

/** 单条 RPC 方法描述。 */
export interface RemoteMethodDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' } | { readonly kind: 'context'; readonly context: string; readonly wire: string }
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly parameters: readonly RemoteParameterDescriptor[]
  readonly result: RemoteCodecDescriptor
}

/** RPC 参数描述。 */
export interface RemoteParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: RemoteCodecDescriptor
}

/** RPC 编解码器描述。 */
export interface RemoteCodecDescriptor {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: { parse(value: unknown): unknown }
}
