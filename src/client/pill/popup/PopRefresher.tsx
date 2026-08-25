import { useState } from 'react'
import type { JSX } from 'react'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'

export function PopRefresher({ refresh, t }: { refresh: () => Promise<void>; t: (key: GitKey) => string }): JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = (): void => {
    if (refreshing) return
    setRefreshing(true)
    void refresh().finally(() => setRefreshing(false))
  }
  return (
    <button type="button" className="dsh-git-ui__refresh" style={css.refreshButton} onClick={onRefresh} disabled={refreshing}>
      {refreshing ? '…' : t('popup.refresh')}
    </button>
  )
}
