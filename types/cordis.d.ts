/**
 * Type shim for `@deepseek-ai/cordis`.
 *
 * The npm ecosystem does not carry the full dsh package chain (`@deepseek-ai/cordis`
 * depends on unpublished packages), so this package cannot install cordis as a
 * dev dependency. At runtime the host dsh installation provides the real cordis
 * through peer dependency resolution; this file only supplies the compile-time
 * surface used by dsh-git-status (shapes copied from the deepseek-harness vendor
 * tree, 0.1.0-rc.x). Keep this file in sync with the subset actually used.
 */
declare module '@deepseek-ai/cordis' {
  /** Minimal Context surface used by host/client halves. */
  export interface Context {
    readonly root: Context
    /** Service registry reflection (service list for gateway SRC discovery). */
    readonly reflect: {
      readonly props: Record<string, { type?: string; [key: string]: unknown }>
      provide(name: string, value: unknown, check?: unknown): void
    }
    /** Look up an optional service by key (undefined when not provided). */
    get<T = unknown>(key: string): T | undefined
    /** Declare services this plugin needs before activation. */
    inject(keys: readonly string[], callback: (ctx: Context) => void): void
    /** Register a side effect with auto-cleanup on fiber dispose. */
    effect(callback: () => void | (() => void | Promise<void>), label?: string): void
    /** Subscribe to an application event; returns an unsubscribe function. */
    on<K extends string>(event: K, listener: (...args: never[]) => void): (() => void) | void
    /** Start a plugin fiber in the current context. */
    plugin(plugin: unknown, config?: unknown): Promise<unknown> & { dispose(): Promise<void> }
    [key: string]: unknown
  }

  /** Base class for services that expose a named API on `ctx`. */
  export abstract class Service<out T = never> {
    static readonly init: unique symbol
    static readonly check: unique symbol
    static readonly config: unique symbol
    static readonly invoke: unique symbol
    static readonly extend: unique symbol
    static readonly tracker: unique symbol
    static readonly resolveConfig: unique symbol
    /** The service name this instance is registered under. */
    public name!: string
    /** Owning context (registered via `super(ctx, name)`). */
    readonly ctx: Context
    constructor(ctx: Context, name: string)
  }
}
