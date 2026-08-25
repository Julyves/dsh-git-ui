import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useUI } from '../../../contracts/ui-context.tsx'
import type { GitAction, GitChange, GitQueryRequest, GitSnapshot } from '../../../host/types.ts'
import type { GitQueryOutcome } from '../../controller.ts'
import { diffBaseOf, reconcileDiffSelection, stepDiffSelection, type DiffSelection } from '../../changes-diff.ts'
import { buildSideBySide, extractAddedContent, isAddOnlyDiff, isBinaryDiff, summarizeChanges } from '../../side-by-side.ts'
import { splitChangePath } from '../../file-tree.ts'
import { NewFileView } from '../../new-file-view.tsx'
import { useSettings } from '../../settings/use-settings.ts'
import { CheckIcon, CloseIcon, DiffIcon, NextIcon, PrevIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'
import { ChangeGroupHeader } from './ChangeGroupHeader.tsx'
import { ChangeRow } from './ChangeRow.tsx'
import { DiffSideBySide } from './DiffSideBySide.tsx'
import { Splitter } from '../Splitter.tsx'
import { byPath, clampNum, groupKeyOfChange, type ChangeGroup, type ChangeGroupKey } from '../shared.ts'


export function ChangesTab({
  snapshot, busy, execute, query, t, openRequest = null,
}: {
  snapshot: GitSnapshot
  busy: boolean
  execute: (action: GitAction, successText: string) => Promise<boolean>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  t: (key: GitKey) => string
  openRequest: { path: string; base: 'worktree' | 'staged' } | null
}): JSX.Element {
  const { Button } = useUI()
  const settings = useSettings()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [armed, setArmed] = useState<string | 'all' | null>(null)
  /** 折叠的分组键。 */
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<ChangeGroupKey>>(new Set())
  /** 左栏宽度（IDEA 式自由拖拽）。 */
  const [leftW, setLeftW] = useState(360)
  /** 当前对照查看的文件（base 取决于暂存态）。 */
  const [diffSel, setDiffSel] = useState<DiffSelection | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const diffSeq = useRef(0)

  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  // IDEA 式三段分组：混合态（MM）双条目天然分列两组；组内路径字母序。
  const stagedItems = useMemo(() => snapshot.changes.filter((c) => c.staged).sort(byPath), [snapshot])
  const unstagedItems = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked').sort(byPath), [snapshot])
  const untrackedItems = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked').sort(byPath), [snapshot])
  const groups: readonly ChangeGroup[] = [
    { key: 'staged' as const, labelKey: 'changes.groupStaged' as const, items: stagedItems },
    { key: 'unstaged' as const, labelKey: 'changes.groupUnstaged' as const, items: unstagedItems },
    { key: 'untracked' as const, labelKey: 'changes.groupUnversioned' as const, items: untrackedItems },
  ].filter((g) => g.items.length > 0)

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 组级全选 / 全消选（半选态由视图按 some/all 推导）。 */
  const selectGroup = (items: readonly GitChange[], check: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of items) {
        if (check) next.add(c.path)
        else next.delete(c.path)
      }
      return next
    })
  }

  const toggleGroupClosed = (key: ChangeGroupKey): void => {
    setClosedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const showDiff = async (path: string, base: 'worktree' | 'staged'): Promise<void> => {
    const seq = ++diffSeq.current
    setDiffSel({ path, base })
    setDiffText(null)
    setDiffLoading(true)
    const outcome = await query({ kind: 'diff', path, base })
    if (seq !== diffSeq.current) return
    setDiffLoading(false)
    setDiffText(outcome.ok && outcome.value.kind === 'diff' ? outcome.value.text : null)
  }

  // 打开定位请求（pill 点击变更文件）：展开文件所在分组并打开对照。
  // 仅随 openRequest 对象引用变化触发；snapshot 轮询由下方 reconcile effect 专门处理。
  useEffect(() => {
    if (openRequest === null) return
    setClosedGroups((prev) => {
      const keys = snapshot.changes.filter((c) => c.path === openRequest.path).map(groupKeyOfChange)
      const need = [...new Set(keys)].filter((k) => prev.has(k))
      if (need.length === 0) return prev
      const next = new Set(prev)
      for (const k of need) next.delete(k)
      return next
    })
    void showDiff(openRequest.path, openRequest.base)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应 openRequest 引用变化；showDiff 每次渲染重建、snapshot 由 reconcile 协调
  }, [openRequest])

  // 差异视图跟随快照：管理操作成功/轮询刷新后，文件消失 → 关闭对照；
  // 暂存侧迁移（MM 双条目）→ 按新基线重取；内容也可能随操作变化 → 一律重取。
  useEffect(() => {
    if (diffSel === null) return
    const desired = reconcileDiffSelection(diffSel, snapshot.changes)
    if (desired === null) {
      diffSeq.current += 1
      setDiffSel(null)
      setDiffText(null)
    } else {
      void showDiff(desired.path, desired.base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 快照驱动的差异协调；showDiff 经 diffSeq 防竞态
  }, [snapshot])

  const commit = (): void => {
    const text = message.trim()
    if (text === '' || busy) return
    const paths = selected.size > 0 ? [...selected] : undefined
    void execute({ kind: 'commit', message: text, ...(paths === undefined ? {} : { paths }) }, t('center.done'))
      .then((ok) => { if (ok) { setSelected(new Set()); setMessage('') } })
  }

  const rowActions = {
    onToggle: toggle,
    onStage: (path: string) => void execute({ kind: 'stage', paths: [path] }, t('center.done')),
    onUnstage: (path: string) => void execute({ kind: 'unstage', paths: [path] }, t('center.done')),
    onDiscard: (path: string) => {
      if (armed === path) {
        void execute({ kind: 'discard', paths: [path] }, t('center.done'))
      } else {
        setArmed((prev) => (prev === path ? null : path))
      }
    },
  }

  /** 差异前后导航序列：三段分组顺序（已暂存 → 更改 → 未版本控制），
   * 排除目录条目（目录无 diff 语义，不应进入对照导航）。 */
  const navEntries = useMemo(() => groups.flatMap((g) => g.items).filter((c) => !c.isDirectory), [groups])

  /** 上一个/下一个更改（循环遍历）；未打开对照时定位第一条。 */
  const navigateDiff = (delta: number): void => {
    const next = stepDiffSelection(navEntries, diffSel, delta)
    if (next !== null) void showDiff(next.path, next.base)
  }

  /** 差异增删摘要（由 diffText 派生；空/无对照时为 null）。 */
  const diffSummary = useMemo(
    () => (diffText === null || diffText === '' ? null : summarizeChanges(buildSideBySide(diffText))),
    [diffText],
  )

  /**
   * 纯新增判定（新增文件视图开关）：
   *   - diff 文本为「纯新增」（--- /dev/null + 全增行）；
   *   - 或 diff 为空且该文件在变更清单中本就是新增/未跟踪——这是
   *     0 字节未跟踪文件（git --no-index 对空文件输出空文本），
   *     同样直接展示（空文件提示）而非无意义的「无差异」空态。
   */
  const isNewFile = useMemo(() => {
    if (diffText === null) return false
    if (diffText === '') {
      return diffSel !== null && snapshot.changes.some(
        (c) => c.path === diffSel.path && (c.status === 'untracked' || c.status === 'added'),
      )
    }
    return !isBinaryDiff(diffText) && isAddOnlyDiff(diffText)
  }, [diffText, diffSel, snapshot.changes])

  return (
    <div style={css.changesLayout}>
      <div style={{ ...css.changesLeft, width: leftW }}>
        <div style={css.toolRow}>
          <button
            type="button"
            className="dsh-git-ui__tool-button"
            style={css.toolButton}
            disabled={busy || (unstagedItems.length === 0 && untrackedItems.length === 0)}
            onClick={() => void execute({ kind: 'stage-all' }, t('center.done'))}
          >
            {t('center.stageAll')}
          </button>
          <button
            type="button"
            className="dsh-git-ui__tool-button"
            style={css.toolButton}
            disabled={busy || stagedItems.length === 0}
            onClick={() => void execute({ kind: 'unstage-all' }, t('center.done'))}
          >
            {t('center.unstageAll')}
          </button>
          <button
            type="button"
            className="dsh-git-ui__tool-button"
            style={armed === 'all' ? { ...css.toolButton, ...css.toolButtonDanger } : css.toolButton}
            disabled={busy || stagedItems.length + unstagedItems.length === 0}
            onClick={() => {
              if (armed === 'all') {
                void execute({ kind: 'discard-all' }, t('center.done'))
              } else {
                setArmed((prev) => (prev === 'all' ? null : 'all'))
              }
            }}
          >
            {armed === 'all' ? t('center.confirmDiscard') : t('center.discardAll')}
          </button>
          <span style={{ flex: 1 }} />
        </div>
        <div style={css.changesList}>
          {snapshot.changes.length === 0
            ? (
              <div style={css.emptyState}>
                <span style={css.emptyStateIcon} aria-hidden="true"><CheckIcon /></span>
                {t('center.empty')}
              </div>
            )
            : (
              <>
                {groups.map((group) => (
                  <div key={group.key}>
                    <ChangeGroupHeader
                      label={t(group.labelKey)}
                      count={group.items.length}
                      closed={closedGroups.has(group.key)}
                      allChecked={group.items.length > 0 && group.items.every((c) => selected.has(c.path))}
                      someChecked={group.items.some((c) => selected.has(c.path))}
                      onToggleClosed={() => toggleGroupClosed(group.key)}
                      onSelectAll={(check) => selectGroup(group.items, check)}
                      t={t}
                    />
                    {!closedGroups.has(group.key) && group.items.map((change) => (
                      <ChangeRow
                        key={change.path}
                        change={change}
                        checked={selected.has(change.path)}
                        busy={busy}
                        armed={armed}
                        diffActive={diffSel !== null && diffSel.path === change.path && diffSel.base === diffBaseOf(change)}
                        rowActions={rowActions}
                        onShowDiff={(p, b) => void showDiff(p, b)}
                        t={t}
                      />
                    ))}
                  </div>
                ))}
                {snapshot.truncated && (
                  <div style={css.emptyNote}>
                    {t('changes.listTruncated')
                      .replace('{count}', String(snapshot.changes.length))
                      .replace('{total}', String(snapshot.staged + snapshot.modified + snapshot.untracked))}
                  </div>
                )}
              </>
            )}
        </div>
        <div style={css.commitBox}>
          <textarea
            className="dsh-git-ui__commit-input"
            style={css.commitInput}
            placeholder={t('center.commitMessage')}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            }}
          />
          <div style={css.commitFooter}>
            {selected.size > 0 && (
              <span style={css.commitHint}>
                {t('center.commitSelected').replace('{count}', String(selected.size))}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={css.commitKbd} aria-hidden="true">⌘/Ctrl + ↵</span>
            <Button variant="primary" size="sm" disabled={busy || message.trim() === ''} onClick={commit}>
              {busy ? t('center.busy') : t('center.commit')}
            </Button>
          </div>
        </div>
      </div>
      <Splitter kind="col" onDrag={(dx) => setLeftW((w) => clampNum(w + dx, 280, 520))} />
      <div style={css.changesRight}>
        {diffSel === null
          ? (
            <div style={css.emptyState}>
              <span style={css.emptyStateIcon} aria-hidden="true"><DiffIcon /></span>
              {t('center.selectFileDiff')}
            </div>
          )
          : (
            <>
              <div style={css.diffToolbar}>
                <span style={css.diffBaseBadge}>
                  {diffSel.base === 'staged' ? t('diff.baseStaged') : t('diff.baseWorktree')}
                </span>
                {(() => {
                  const { name, dir } = splitChangePath(diffSel.path)
                  return (
                    <>
                      {dir !== '' && <span style={css.diffPathDir} title={diffSel.path}>{dir}</span>}
                      <span style={css.diffPathName}>{name}</span>
                    </>
                  )
                })()}
                {isNewFile && (
                  <span style={{ ...css.diffBaseBadge, ...css.diffNewBadge }}>{t('diff.badgeNew')}</span>
                )}
                {diffSummary !== null && (diffSummary.add > 0 || diffSummary.del > 0) && (
                  <span style={css.diffSummary}>
                    {diffSummary.add > 0 && <span style={css.diffSummaryAdd}>+{diffSummary.add}</span>}
                    {diffSummary.del > 0 && <span style={css.diffSummaryDel}>−{diffSummary.del}</span>}
                  </span>
                )}
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('diff.prev')}
                  aria-label={t('diff.prev')}
                  disabled={busy || navEntries.length === 0}
                  onClick={() => navigateDiff(-1)}
                >
                  <PrevIcon />
                </button>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('diff.next')}
                  aria-label={t('diff.next')}
                  disabled={busy || navEntries.length === 0}
                  onClick={() => navigateDiff(1)}
                >
                  <NextIcon />
                </button>
                <button
                  type="button"
                  className="dsh-git-ui__icon-btn"
                  style={css.rowIconButton}
                  title={t('center.close')}
                  aria-label={t('center.close')}
                  onClick={() => { diffSeq.current += 1; setDiffSel(null); setDiffText(null) }}
                >
                  <CloseIcon />
                </button>
              </div>
              {diffLoading
                ? <div style={css.emptyNote}>{t('center.loading')}</div>
                : diffText === null
                  ? <div style={css.emptyNote}>{t('center.diffEmpty')}</div>
                  : isNewFile
                    ? (
                      <NewFileView
                        key={diffSel.path}
                        content={diffText === '' ? '' : extractAddedContent(diffText)}
                        path={diffSel.path}
                        fontSize={settings.diff.fontSize}
                        highlight={settings.diff.syntaxHighlight}
                        t={t}
                      />
                    )
                    : (
                      <DiffSideBySide
                        key={diffSel.path}
                        text={diffText}
                        path={diffSel.path}
                        diff={settings.diff}
                        t={t}
                      />
                    )}
            </>
          )}
      </div>
    </div>
  )
}
