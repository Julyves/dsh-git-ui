/**
 * Git status widget — client half entry.
 *
 * The bundle is a ModuleLoader closure: `factory(require)` returns the plugin
 * shape `{ name, inject, apply }`; the framework activates it once the listed
 * services exist.
 *
 * Service-access contract (verified against cordis 0.1.0-rc.x): the gitInfo
 * namespace service is provided by OUR OWN `ctx.remote.$mount(gitInfoRemote)`
 * inside apply, so the main fiber can never declare `remote.gitInfo` in its
 * `inject` — cordis would wait for the service before running apply, and the
 * service only appears once apply runs (deadlock). Conversely, accessing
 * `ctx.remote.gitInfo` without the inject declaration throws cordis's
 * "cannot get property ... without inject". The consumer therefore lives in a
 * CHILD fiber created after the mount: its inject declares `remote.gitInfo`,
 * and by the time it activates the service already exists — no wait, no
 * access violation. (In-repo plugins like ui-message-feedback can inject
 * their namespace directly because a separate assembly package mounts it; a
 * standalone plugin mounts its own.)
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
  /** Register a nested cordis plugin (fiber) under this context. */
  plugin(definition: {
    readonly name: string
    readonly inject: readonly string[]
    apply: (ctx: ClientContext) => void | Promise<void>
  }): Promise<unknown>
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
 * `remote.gitInfo` is deliberately NOT listed here — see the module comment:
 * the namespace is mounted by our own apply, so injecting it would deadlock.
 * The child fiber that consumes it declares it instead (after the mount).
 */
export const inject = ['slots', 'remote', 'locale'] as const

/** Plugin identity: the factory handoff returns this plus the exports above. */
export const name = 'dsh-git-status-pill'

/**
 * Plugin body: register copy, mount the gitInfo Remote, then host the header
 * utility in a child fiber that may legitimately access `remote.gitInfo`.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register('git', { zh, en }), 'dsh-git-status-pill: dictionaries')

  // Mount first — the namespace service only exists after this resolves.
  await ctx.remote.$mount(gitInfoRemote)

  const controllers = new Map<string, GitController>()
  const faces = new Map<string, GitInjected>()

  // Consumer fiber: `remote.gitInfo` is declared in ITS inject list, so the
  // access inside the controller factory is legal; the service is already
  // provided by the mount above, so activation does not wait (no deadlock).
  const child = ctx.plugin({
    name: 'dsh-git-status-pill:git',
    inject: ['slots', 'remote.gitInfo'],
    apply: (sub) => {
      const controllerFor = (sessionId: string): GitController => {
        let controller = controllers.get(sessionId)
        if (controller === undefined) {
          controller = new GitController(sub.remote.gitInfo, sessionId)
          controllers.set(sessionId, controller)
        }
        return controller
      }

      sub.slots.inject('conversation.session.header.utilities', () => {
        const dispose = sub.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'git',
          order: 10,
          locale: 'git',
          inject: (sessionId): GitInjected => {
            // Per-session stable face: the slot runtime may re-invoke the
            // inject factory on every render, and components depend on the
            // `refresh` reference staying stable (a fresh arrow function per
            // call would re-run mount effects and loop: refresh → view
            // change → re-render → new refresh → refresh …). Cache the face
            // so the same controller (and its bound refresh) is always
            // handed out per session.
            let face = faces.get(sessionId)
            if (face === undefined) {
              const controller = controllerFor(sessionId)
              face = {
                hooks: { git: controller as GitInjected['hooks']['git'] },
                refresh: () => controller.refresh(),
              }
              faces.set(sessionId, face)
            }
            return face
          },
        }, GitPill)
        return () => {
          dispose()
          for (const controller of controllers.values()) controller.dispose()
          controllers.clear()
          faces.clear()
        }
      })
    },
  })
  await child

  // A reconnect can only invalidate what was already read; a cold Session
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.resync()
  })
}
