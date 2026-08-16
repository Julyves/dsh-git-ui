/**
 * Type shim for `@deepseek-ai/dsh-typert-protocol`.
 *
 * Same rationale as `cordis.d.ts`: the runtime implementation is provided by the
 * host dsh installation (peer dependency); this file supplies the compile-time
 * surface used by dsh-git-status-pill (shapes copied from the deepseek-harness
 * `packages/typert/protocol` source, 0.1.0-rc.x).
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context, Service } from '@deepseek-ai/cordis'

  /** Visible declaration that one Service participates in Typert Gateway export. */
  export interface TypertGatewayBinding<ServiceT extends object = object> {
    readonly service: ServiceT
    readonly serviceKey: string
    readonly namespace: string
  }

  /** Cordis Service base that exposes its registered name through Typert Gateway. */
  export abstract class TypertRemoteService<out T = never> extends Service<T> {
    /** Visible binding consumed by the Gateway's source-mode discovery. */
    readonly typertRemote: TypertGatewayBinding<this>
    protected constructor(ctx: Context, serviceKey: string, options?: { namespace?: string })
  }

  /** Standard method decorator marking a Remote endpoint. */
  export type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  /** Mark one public instance method as a direct Remote invocation. */
  export function Remote(exportName: string): RemoteMethodDecorator

  /** Read Remote markers attached to a live Service by decorator initializers. */
  export function remoteMethods(service: object): readonly {
    readonly method: string
    readonly exportName?: string
    readonly invocation: { readonly kind: 'direct' } | { readonly kind: 'context'; readonly context: string }
  }[]

  /** One codec for a Remote parameter/result (strict = zod-validated). */
  export interface TypertCodec {
    readonly mode: 'strict'
    readonly typeSymbol: string
    readonly schema: { parse(value: unknown): unknown }
  }

  /** One Remote method descriptor inside a contribution. */
  export interface InvocationDescriptor {
    readonly id: string
    readonly service: string
    readonly namespace: string
    readonly method: string
    readonly invocation: { readonly kind: 'direct' } | { readonly kind: 'context'; readonly context: string; readonly wire: string }
    readonly parameters: readonly {
      readonly name: string
      readonly wire: string
      readonly source: 'json'
      readonly codec: TypertCodec
    }[]
    readonly result: TypertCodec
  }

  /** Client-side contribution mounted via `ctx.remote.$mount`. */
  export interface TypertRemoteContribution {
    readonly package: string
    readonly descriptors: readonly InvocationDescriptor[]
  }

  /** The `remote` service face mounted by the api-gateway client half. */
  export interface TypertClientRemote {
    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
  }
}
