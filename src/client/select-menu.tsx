/**
 * 自绘下拉选择器（平台 Menu 规范）：取代原生 select，明暗主题与系统样式统一。
 * 从 GitCenter.tsx 提取为共享组件，供 GitPill 分支管理复用。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, JSX } from 'react'
import * as css from './styles.ts'

export interface SelectMenuProps {
  value: string
  options: readonly { value: string; label: string }[]
  onSelect: (value: string) => void
  ariaLabel: string
  /** 按钮自定义样式（默认 toolbarSelect；头部内联用时传无框变体）。 */
  buttonStyle?: CSSProperties
}

export function SelectMenu({
  value, options, onSelect, ariaLabel, buttonStyle,
}: SelectMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = (): void => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 140) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) ?? false) return
      if (menuRef.current?.contains(target) ?? false) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="dsh-git-ui__toolbar-select"
        style={buttonStyle ?? css.toolbarSelect}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span style={css.selectLabel}>{current?.label ?? ''}</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            flex: 'none',
            transition: 'transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        >
          <svg width={10} height={10} viewBox="0 0 10 10">
            <path d="M1.5 3 L5 7 L8.5 3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className="dsh-git-ui__select-menu"
          style={{ ...css.selectMenu, top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              style={o.value === value ? { ...css.selectOption, ...css.selectOptionActive } : css.selectOption}
              className="dsh-git-ui__row"
              onClick={() => { onSelect(o.value); setOpen(false) }}
            >
              <span style={{ ...css.treeCaret, visibility: o.value === value ? 'visible' : 'hidden' }} aria-hidden="true">✓</span>
              <span style={css.selectLabel}>{o.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
