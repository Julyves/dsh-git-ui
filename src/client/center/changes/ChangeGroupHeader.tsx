import type { JSX } from 'react'
import { ChevronIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'


/**
 * IDEA 式分组头：粘性吸顶——组级全选（含半选态）+ 折叠箭头 + 名称 + 计数。
 * 复选框与折叠按钮为独立控件，均可键盘操作。
 */
export function ChangeGroupHeader({
  label, count, closed, allChecked, someChecked, onToggleClosed, onSelectAll, t,
}: {
  label: string
  count: number
  closed: boolean
  allChecked: boolean
  someChecked: boolean
  onToggleClosed: () => void
  onSelectAll: (check: boolean) => void
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <div style={css.groupHeader}>
      <input
        type="checkbox"
        className="dsh-git-ui__checkbox"
        style={css.changeCheckbox}
        checked={allChecked}
        ref={(el) => { if (el !== null) el.indeterminate = someChecked && !allChecked }}
        onChange={(e) => onSelectAll(e.target.checked)}
        aria-label={`${label} ${t('changes.selectAll')}`}
      />
      <button type="button" style={css.groupHeaderToggle} onClick={onToggleClosed} aria-expanded={!closed}>
        <ChevronIcon open={!closed} />
        <span>{label}</span>
        <span style={css.groupHeaderCount}>{count}</span>
      </button>
    </div>
  )
}
