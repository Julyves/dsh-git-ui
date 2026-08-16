/**
 * Type shim for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * Platform module (externalized in the client bundle, provided by the host
 * loader table); this package only needs the `Modal` controlled dialog, so
 * the surface is declared here by hand (mirrored from the ui-primitives
 * source, 0.1.0-rc.x).
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'

  /** Controlled full-viewport dialog over a blurred mask (Escape/mask close). */
  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    closeLabel?: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    headless?: boolean
  }): ReactNode
}
