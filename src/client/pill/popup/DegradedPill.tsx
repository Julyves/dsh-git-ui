import type { JSX } from 'react'
import { AlertIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'

export function DegradedPill({ label, title, t }: { label: string; title?: string; t: (key: GitKey) => string }): JSX.Element {
  void t
  return (
    <span className="dsh-git-ui__pill" style={css.pillDimmed} title={title} aria-label={label}>
      <span style={css.pillDimmedIcon} aria-hidden="true"><AlertIcon /></span>
      {label}
    </span>
  )
}

/**
 * Popup body (rendered inside the portaled card)。
 * 分支管理（切换/新建）已并入本组件：头部内联切换 + 新建行上提；
 * 变更行带 hover 内联操作（暂存/取消/丢弃两步）。
 * 各区块按 `settings.popup` 设置驱动显隐；头部徽章沿 `settings.pill`。
 */
