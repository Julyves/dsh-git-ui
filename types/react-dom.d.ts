/**
 * Minimal type shim for `react-dom` (platform module).
 *
 * The browser loader's module table provides the real `react-dom` at runtime
 * (dsh-client-web / platform externals); this package needs only
 * `createPortal` for the popup, so instead of adding a dependency the shape
 * is declared here by hand (ReactPortal type mirrored from @types/react).
 */
declare module 'react-dom' {
  import type { ReactNode } from 'react'
  import type { ReactPortal } from 'react'
  export function createPortal(node: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal
  export function flushSync<R>(fn: () => R): R
  export const version: string
}
