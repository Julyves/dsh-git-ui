/**
 * Style constants for the git widget.
 *
 * Colors resolve exclusively through the host theme's `--dsw-alias-*` design
 * tokens (ui-theme design-platform.css), so the widget follows the active
 * light/dark theme automatically — never hard-coded surfaces. Layout mirrors
 * the official primitives: the pill is a 24px `Pill`-style chip, the popup a
 * `Menu`-surface card (border-l1, radius 12, shadow-lv3).
 *
 * The popup is a fixed-position card portaled to document.body (see
 * GitPill.tsx) — it must never participate in header layout, otherwise it
 * grows the header and distorts it.
 */
import type { CSSProperties } from 'react'

/** 样式按域拆分到 styles/ 子目录；此处为聚合 barrel，调用方零改动。 */

export * from './styles/pill.ts'
export * from './styles/work.ts'
export * from './styles/popup.ts'
export * from './styles/shared.ts'
export * from './styles/globals.ts'
export * from './styles/center.ts'
export * from './styles/changes.ts'
export * from './styles/new-file.ts'
export * from './styles/history.ts'
export * from './styles/settings.ts'
