/** 可复用分栏拖拽条（changes/history 左右/上下分栏）。 */
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import * as css from '../styles.ts'

export function Splitter({ kind, onDrag }: { kind: 'col' | 'row'; onDrag: (delta: number) => void }): JSX.Element {
  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault()
    let lastX = e.clientX
    let lastY = e.clientY
    const move = (ev: MouseEvent): void => {
      onDrag(kind === 'col' ? ev.clientX - lastX : ev.clientY - lastY)
      lastX = ev.clientX
      lastY = ev.clientY
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div
      className="dsh-git-ui__splitter"
      style={kind === 'col' ? css.splitter : css.splitterRow}
      role="separator"
      aria-orientation={kind === 'col' ? 'vertical' : 'horizontal'}
      onMouseDown={onMouseDown}
    />
  )
}
