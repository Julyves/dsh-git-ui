/**
 * Type shim for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * Platform module (externalized in the client bundle, provided by the host
 * loader table); this package only needs the `Modal` dialog, the `Button`
 * atom and the transient `Toast` banner, so the surface is declared here by
 * hand (mirrored from the ui-primitives source, 0.1.0-rc.x).
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ReactNode } from 'react'

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

  /** Token-styled button atom (native button attributes pass through). */
  export function Button(props: {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string | undefined
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode

  /**
   * Transient top-center banner: slides in, holds ~3s, fades out, then calls
   * `onDone` so the owner can unmount it.
   */
  export function Toast(props: {
    text: string
    icon?: ReactNode
    anchor?: HTMLElement | null
    onDone: () => void
  }): ReactNode
}
