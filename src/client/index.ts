/**
 * Git status widget — client half entry.
 *
 * The bundle is a ModuleLoader closure: `factory(require)` returns the plugin
 * shape `{ name, inject, apply }`; the framework activates it once the listed
 * services exist. The Remote contribution is mounted first (awaiting the
 * `remote` service), then the header utility slot is registered — the `gitInfo`
 * namespace service is guaranteed ready because the slot body creates
 * controllers against `ctx.remote.gitInfo` only after the await.
 */
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { GitController, type GitView, type GitObservable, type GitRemoteLike } from './controller.ts'
import { gitInfoRemote } from './remote.ts'
import { GitPill, type GitInjected } from './GitPill.tsx'
import { en, zh } from './locales.ts'

/** Structural face of the browser plugin context (host-provided). */
interface ClientContext {
  get<T = unknown>(key: string): T | undefined
  /** Subscribe to an application event (auto-cleaned on fiber dispose). */
  on(event: string, listener: (...args: never[]) => void): (() => void) | void
  /** Register a side effect with auto-cleanup on fiber dispose. */
  effect(callback: () => void | (() => void | Promise<void>), label?: string): void
  /** The typed Client Remote mount + mounted namespaces. */
  remote: {
    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
    gitInfo: GitRemoteLike
  }
  /** The slot registry (ui-slots). */
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
  /** The locale service (ui-locale). */
  locale: {
    register(namespace: string, dictionaries: { readonly zh: Record<string, string>; readonly en: Record<string, string> }): void
  }
  [key: string]: unknown
}

/**
 * Required services: slot registry, Remote base (gateway client), and copy.
 *
 * NOTE: `remote.gitInfo` must NOT be injected here — that namespace service is
 * registered by OUR OWN `ctx.remote.$mount(gitInfoRemote)` below. Injecting it
 * would deadlock: cordis waits for the service before running apply, but the
 * service only appears when apply runs. (In-repo plugins like ui-message-
 * feedback can inject their namespace because a separate assembly package
 * mounts it; a standalone plugin mounts its own.)
 */
export const inject = ['slots', 'remote', 'locale'] as const

/** Plugin identity: the factory handoff returns this plus the exports above. */
export const name = 'dsh-git-status'

/**
 * Plugin body: register copy, mount the gitInfo Remote, then contribute the
 * header utility. The Remote mount completes before the slot registers, so
 * controllers always see a live `ctx.remote.gitInfo`.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register('git', { zh, en }), 'dsh-git-status: dictionaries')

  const controllers = new Map<string, GitController>()
  const controllerFor = (sessionId: string): GitController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new GitController(ctx.remote.gitInfo, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  await ctx.remote.$mount(gitInfoRemote)

  // A reconnect can only invalidate what was already read; a cold Session
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.resync()
  })

  ctx.slots.inject('conversation.session.header.utilities', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'git',
      order: 10,
      locale: 'git',
      inject: (sessionId): GitInjected => {
        const controller = controllerFor(sessionId)
        return {
          hooks: { git: controller as GitInjected['hooks']['git'] },
          refresh: () => controller.refresh(),
        }
      },
    }, GitPill)
    return () => {
      dispose()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
    }
  })
}

