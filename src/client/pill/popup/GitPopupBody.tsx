import { Fragment, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useUI } from '../../../contracts/ui-context.tsx'
import type { GitQueryOutcome, GitView } from '../../controller.ts'
import { AlertIcon, CloseIcon, fileIconForPath, FolderIcon, GearIcon, RecordIcon, RollbackIcon, StageIcon, UnstageIcon } from '../../icons.tsx'
import type { GitAction, GitActionResult, GitBranch, GitOperationErrorCode, GitQueryRequest } from '../../../host/types.ts'
import type { GitKey } from '../../locales.ts'
import { SelectMenu } from '../../select-menu.tsx'
import { splitChangePath } from '../../file-tree.ts'
import { diffBaseOf } from '../../changes-diff.ts'
import { errorText, errorAction } from '../../error-text.ts'
import { chipLetter, popupBadgeTexts } from '../../pill-segments.tsx'
import { latestWorkTurn, turnEntryCounts } from '../../work-record-meta.ts'
import { EntryRow } from '../../records/entry-row.tsx'
import type { GitUISettings, PopupBlockId } from '../../../contracts/settings.ts'
import { normalizePopupOrder } from '../../../contracts/settings.ts'
import type { TurnWorkRecord } from '../../../host/types.ts'
import * as css from '../../styles.ts'
import { timeAgo, shortTime } from '../../center/shared.ts'
import { PopRefresher } from './PopRefresher.tsx'

/** Dimmed pill for degraded states（弱化图标锚点 + 说明文字）。 */

export function GitPopupBody({
  view, settings, refresh, openCenter, openRecords, openSettings, onOpenDiff, onOpenCommit, run, query, records, onReclassify, t,
}: {
  view: GitView & { state: 'ready' }
  settings: GitUISettings
  refresh: () => Promise<void>
  openCenter: () => void
  /** 打开 Git 中心并定位到「记录」Tab。 */
  openRecords: () => void
  /** 打开 Git 中心并定位到设置页。 */
  openSettings: () => void
  /** 变更文件点击：打开 Git 中心并定位该文件的对照视图。 */
  onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  /** 最近提交行点击：打开 Git 中心并定位该提交（历史页哈希直达选中）。 */
  onOpenCommit: (hash: string) => void
  run: (action: GitAction) => Promise<GitActionResult>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  /** turn 工作记录(最近窗口用于徽章与分组);null = 未就绪。 */
  records: readonly TurnWorkRecord[] | null
  /** 人工改判归因(与记录页一致的三段 ⇄ 入口)。 */
  onReclassify: (path: string, to: 'internal' | 'sibling' | 'external') => void
  t: (key: GitKey) => string
}): JSX.Element {
  const { Button } = useUI()
  const now = Date.now()
  const s = view.snapshot
  const branchLabel = s.branch === null ? `(${t('pill.detached')})` : s.branch

  /** 分支管理状态（自原 BranchQuickManage 并入）：切换（头部内联）+ 新建（上提）。 */
  const [branchData, setBranchData] = useState<{ current: string | null; local: readonly GitBranch[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState<{ text: string; detail?: string; action?: 'open-center' } | null>(null)
  // 变更行丢弃两步确认：armed 记录待确认的路径，3s 自动解除。
  const [armed, setArmed] = useState<string | null>(null)

  /** 操作失败 → 友好告警：业务错误用 i18n 文案 + 行动按钮，原始信息留 detail。 */
  const setErrorNote = (err: { code: GitOperationErrorCode; message?: string }): void => {
    setNote({
      text: errorText(err.code, err.message, t),
      ...(err.message === undefined ? {} : { detail: err.message }),
      ...(errorAction(err.code) === null ? {} : { action: errorAction(err.code) ?? undefined }),
    })
  }

  const reload = async (): Promise<void> => {
    const outcome = await query({ kind: 'branches' })
    if (outcome.ok && outcome.value.kind === 'branches') {
      setBranchData({ current: outcome.value.current, local: outcome.value.local })
    }
  }

  useEffect(() => {
    // 分支数据仅为切换器服务：关闭时跳过查询（省一次 RPC），打开时加载。
    if (settings.popup.branchSwitcher) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随切换器开关变化
  }, [settings.popup.branchSwitcher])

  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const switchTo = async (name: string): Promise<void> => {
    if (busy || name === '') return
    setBusy(true)
    setNote(null)
    const result = await run({ kind: 'branch-checkout', name })
    setBusy(false)
    if (!result.ok) setErrorNote(result.error)
    await reload()
  }

  const createAndSwitch = async (): Promise<void> => {
    const name = newName.trim()
    if (name === '' || busy) return
    setBusy(true)
    setNote(null)
    const created = await run({ kind: 'branch-create', name })
    if (created.ok) {
      const switched = await run({ kind: 'branch-checkout', name })
      if (!switched.ok) setErrorNote(switched.error)
      setNewName('')
    } else {
      setErrorNote(created.error)
    }
    setBusy(false)
    await reload()
  }

  /** 执行一条变更行操作（暂存/取消/丢弃），失败以 note 显示。 */
  const runChange = async (action: GitAction, path: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    const result = await run(action)
    setBusy(false)
    if (!result.ok) setErrorNote(result.error)
  }

  const stage = (path: string): void => void runChange({ kind: 'stage', paths: [path] }, path)
  const unstage = (path: string): void => void runChange({ kind: 'unstage', paths: [path] }, path)
  const discard = (path: string): void => {
    if (busy) return
    if (armed !== path) { setArmed(path); return }
    setArmed(null)
    void runChange({ kind: 'discard', paths: [path] }, path)
  }

  // ── 弹窗区块（顺序可自定义） ──────────────────────────────────────────
  // 头部/底部结构固定；五个内容区块收敛为元素常量，按 settings.popupOrder
  // 组装（设置页「弹窗区块顺序」卡片驱动；normalizePopupOrder 消毒任意来源）。

  const blockHeader: JSX.Element = (
      <header style={css.popupHeader}>
        <div style={css.popupHeaderMain}>
          <span style={s.dirty ? css.dotDirty : css.dot} aria-hidden="true" />
          {settings.popup.branchSwitcher
            ? (
              branchData === null
                ? <span style={css.popupHeaderBranch}>{branchLabel}</span>
                : (
                  <SelectMenu
                    value={branchData.current ?? ''}
                    options={[
                      // 游离 HEAD：注入伪选项让头部显示游离标签，仍可下拉切换本地分支。
                      ...(branchData.current === null ? [{ value: '', label: branchLabel }] : []),
                      ...branchData.local.map((b) => ({ value: b.name, label: b.name })),
                    ]}
                    onSelect={(name) => void switchTo(name)}
                    ariaLabel={t('center.currentBranch')}
                    buttonStyle={css.popupBranchMenu}
                  />
                )
            )
            : <span style={css.popupHeaderBranch}>{branchLabel}</span>}
          {s.unborn && <span style={css.popupBadge}>{t('pill.noCommits')}</span>}
          {popupBadgeTexts(s, settings.pill).map((badge) => (
            <span key={badge.key} style={css.popupBadge}>{badge.text}</span>
          ))}
        </div>
        <div style={css.popupHeaderRootRow}>
          {settings.popup.rootPath && (
            <div style={css.popupHeaderRoot} title={s.root}>
              <FolderIcon />
              <span style={css.popupHeaderRootText}>{s.root}</span>
            </div>
          )}
          {!settings.popup.rootPath && <span style={{ flex: 1 }} />}
          <button
            type="button"
            className="dsh-git-ui__icon-btn"
            style={css.rowIconButton}
            title={t('settings.gear')}
            aria-label={t('settings.gear')}
            onClick={openSettings}
          >
            <GearIcon />
          </button>
        </div>
      </header>
  )

  const blockStatusBar: JSX.Element | null = settings.popup.statusBar ? (
        <div style={css.popupStatusBar}>
          {([
            ['popup.staged', s.staged], ['popup.modified', s.modified], ['popup.untracked', s.untracked],
          ] as const).map(([key, value]) => (
            <span key={key} style={css.popupStatItem}>
              <span style={css.popupStatValue}>{value}</span>
              <span style={css.popupStatLabel}>{t(key)}</span>
            </span>
          ))}
          {/* 已领先/已落后恒显示(0 值展示 ↑0/↓0);上次提交补全时间维度(无提交显示"无提交")。
             六格 grid 三列两行:第一行工作区三态,第二行同步与历史。 */}
          <span style={css.popupStatItem}>
            <span style={css.popupStatValue}>↑{s.ahead}</span>
            <span style={css.popupStatLabel}>{t('popup.ahead')}</span>
          </span>
          <span style={css.popupStatItem}>
            <span style={css.popupStatValue}>↓{s.behind}</span>
            <span style={css.popupStatLabel}>{t('popup.behind')}</span>
          </span>
          <span style={css.popupStatItem}>
            <span style={css.popupStatValue}>{
              s.lastCommit === null ? t('pill.noCommits') : timeAgo(s.lastCommit.dateIso, now, t)
            }</span>
            <span style={css.popupStatLabel}>{t('popup.lastCommit')}</span>
          </span>
        </div>
    )
    : null

  const blockBranchCreate: JSX.Element | null = settings.popup.branchCreate ? (
        <div style={css.popupBranchOps}>
          <input
            className="dsh-git-ui__branch-input"
            style={css.branchNameInput}
            placeholder={t('center.branchName')}
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createAndSwitch() }}
          />
          <Button size="sm" disabled={busy || newName.trim() === ''} onClick={() => void createAndSwitch()}>
            {t('center.createAndSwitch')}
          </Button>
        </div>
    )
    : null

  /** 操作告警条：紧跟头部常驻首位（不参与排序——告警优先可见）。 */
  const blockNote: JSX.Element | null = note !== null ? (
        <div style={css.popupNote} role="alert">
          <span style={css.popupNoteIcon} aria-hidden="true"><AlertIcon /></span>
          <span style={css.popupNoteText} title={note.detail}>{note.text}</span>
          {note.action === 'open-center' && (
            <button type="button" className="dsh-git-ui__change-link" style={css.popupNoteAction} onClick={openCenter}>
              {t('error.handleChanges')}
            </button>
          )}
          <button
            type="button"
            className="dsh-git-ui__icon-btn"
            style={css.popupNoteClose}
            title={t('center.close')}
            aria-label={t('center.close')}
            onClick={() => setNote(null)}
          >
            <CloseIcon />
          </button>
        </div>
    )
    : null

  /** 工作记录区块：显隐由 popup.workRecord 独立治理（v5 起与 pill 徽章分离）。 */
  const blockWorkRecord: JSX.Element | null = settings.popup.workRecord && records !== null
    ? (() => {
        const windowTurn = latestWorkTurn(records)
        const { internal, sibling, external } = turnEntryCounts(windowTurn)
        const hasAny = internal > 0 || sibling > 0 || external > 0
        return (
          <>
            <div style={css.workSectionHead}>
              <span style={css.workSectionIcon} aria-hidden="true"><RecordIcon /></span>
              <span style={css.workSectionText}>
                <span style={css.workSectionTitle}>{t('work.section')}</span>
                <span style={css.workSectionSub}>
                  {windowTurn === undefined
                    ? t('work.empty')
                    : `${windowTurn.narrative !== null ? `${windowTurn.narrative} · ` : ''}${t('work.recentWindow')} · ${t('work.range').replace('{from}', shortTime(windowTurn.startAt)).replace('{to}', windowTurn.endAt === null ? t('work.running') : shortTime(windowTurn.endAt))}`}
                </span>
              </span>
            </div>
            {hasAny ? (
              <>
                {/* 本 Turn 变更不设分组标题——区块头「最近 turn 工作时段」已说明归属。
                    条目行与记录页共用 EntryRow（4 元素排版）；仍变更条目可点击跳 Git 中心 diff；
                    三段均带 ⇄ 纠错入口（与记录页一致，P3-7 弹窗入口补齐）。 */}
                {windowTurn !== undefined && windowTurn.internal.map((entry) => (
                  <EntryRow key={`pi-${entry.path}`} entry={entry} t={t} onOpenDiff={onOpenDiff} group="internal" onReclassify={onReclassify} />
                ))}
                {sibling > 0 && (
                  <div style={css.workGroupTitle}>
                    <span style={css.workBadgeDotSibling} aria-hidden="true" />
                    {t('work.group.sibling')} {sibling}
                  </div>
                )}
                {windowTurn !== undefined && windowTurn.sibling.map((entry) => (
                  <EntryRow key={`ps-${entry.path}`} entry={entry} t={t} onOpenDiff={onOpenDiff} group="sibling" onReclassify={onReclassify} />
                ))}
                {external > 0 && (
                  <div style={css.workGroupTitle}>
                    <span style={css.workBadgeDotExternal} aria-hidden="true" />
                    {t('work.group.external')} {external}
                  </div>
                )}
                {windowTurn !== undefined && windowTurn.external.map((entry) => (
                  <EntryRow key={`pe-${entry.path}`} entry={entry} t={t} onOpenDiff={onOpenDiff} group="external" onReclassify={onReclassify} />
                ))}
              </>
            ) : (
              <div style={css.workEmptyState}>
                <span style={css.workEmptyIcon} aria-hidden="true"><RecordIcon /></span>
                <span style={css.workEmptyText}>{t('work.empty')}</span>
              </div>
            )}
            <button
              type="button"
              className="dsh-git-ui__change-link"
              style={css.workAllLink}
              onClick={openRecords}
            >
              {t('work.all')} →
            </button>
          </>
        )
      })()
    : null

  const blockRecentCommits: JSX.Element | null = settings.popup.recentCommits > 0 ? (
        <>
          <div style={css.sectionTitle}>{t('popup.recentCommits')}</div>
          {s.recentCommits.length === 0
            ? (
              <div style={css.emptyStateSmall}>
                <span style={css.emptyStateDot} aria-hidden="true" />
                {t('popup.emptyCommits')}
              </div>
            )
            : s.recentCommits.slice(0, settings.popup.recentCommits).map((commit) => (
              // 整行可点击深链：打开 Git 中心历史页并哈希直达选中该提交。
              // 仅在本区块渲染（recentCommits > 0 守卫已含设置语义）。
              <button
                key={commit.hash}
                type="button"
                className="dsh-git-ui__row dsh-git-ui__change-link"
                style={css.commitRowBtn}
                title={`${commit.subject} · ${commit.shortHash} — ${t('popup.openCommit')}`}
                onClick={() => onOpenCommit(commit.hash)}
              >
                <div style={css.commitSubjectPop}>{commit.subject}</div>
                <div style={css.commitMetaLine}>
                  <span style={css.commitHash}>{commit.shortHash}</span>
                  <span style={css.commitDot}>·</span>
                  <span style={css.commitMeta}>{commit.author}</span>
                  <span style={css.commitDot}>·</span>
                  <span style={css.commitMeta}>{timeAgo(commit.dateIso, now, t)}</span>
                </div>
              </button>
            ))}
        </>
    )
    : null

  const blockChangesList: JSX.Element | null = settings.popup.changesList ? (
        <>
          <div style={css.sectionTitle}>{t('popup.changes')}</div>
          {s.changes.length === 0
            ? (
              <div style={css.emptyStateSmall}>
                <span style={css.emptyStateDot} aria-hidden="true" />
                {t('popup.empty')}
              </div>
            )
            : (
              <>
                {s.changes.map((change) => {
                  const { name, dir, isDir } = splitChangePath(change.path, change.isDirectory)
                  const untracked = change.status === 'untracked'
                  // 按变更类型给文件名/目录名着色（与 Git 中心 IDEA 式一致：增/未跟踪绿、改/重命名蓝、删/冲突红、类型变更橙）。
                  const statusColor = css.statusTextColor[change.status] ?? 'var(--dsw-alias-label-primary)'
                  return (
                    <div key={change.path} className="dsh-git-ui__row" style={css.changeRow}>
                      <span
                        style={{ ...css.changeChip, ...(css.chipStyles[change.status] ?? css.chipStyles.untracked) }}
                        title={change.status}
                      >
                        {chipLetter(change.status)}
                      </span>
                      <span style={css.rowFileIcon} aria-hidden="true">
                        {isDir ? <FolderIcon /> : fileIconForPath(change.path)}
                      </span>
                      {isDir ? (
                        // 目录条目：点击打开 Git 中心变更页（目录无 diff 语义，展开后选具体文件）。
                        <button
                          type="button"
                          className="dsh-git-ui__change-link"
                          style={{ ...css.changeNamePopBtn, color: statusColor }}
                          title={change.path}
                          aria-label={`${name} — ${t('center.open')}`}
                          onClick={openCenter}
                        >
                          {name}
                        </button>
                      ) : (
                        // 文件条目：点击打开 Git 中心并直接展示该文件对照。
                        <button
                          type="button"
                          className="dsh-git-ui__change-link"
                          style={{ ...css.changeNamePopBtn, color: statusColor }}
                          title={change.path}
                          aria-label={`${name} — ${t('changes.actionDiff')}`}
                          onClick={() => onOpenDiff(change.path, diffBaseOf(change))}
                        >
                          {name}
                        </button>
                      )}
                      {dir !== '' ? <span style={css.changeDirPop}>{dir}</span> : <span style={{ flex: '1 1 0%', minWidth: 0 }} />}
                      <span className="dsh-git-ui__row-actions" style={css.rowActions}>
                        {change.staged
                          ? (
                            <button type="button" className="dsh-git-ui__icon-btn" style={css.rowIconButton} title={t('center.unstage')} aria-label={t('center.unstage')} disabled={busy} onClick={() => unstage(change.path)}>
                              <UnstageIcon />
                            </button>
                          )
                          : (
                            <button type="button" className="dsh-git-ui__icon-btn" style={css.rowIconButton} title={t('center.stage')} aria-label={t('center.stage')} disabled={busy} onClick={() => stage(change.path)}>
                              <StageIcon />
                            </button>
                          )}
                        {!untracked && (
                          <button
                            type="button"
                            className="dsh-git-ui__icon-btn"
                            style={armed === change.path ? { ...css.rowIconButton, color: 'var(--dsw-alias-state-error-primary)' } : css.rowIconButton}
                            title={armed === change.path ? t('center.confirmDiscard') : t('center.discard')}
                            aria-label={armed === change.path ? t('center.confirmDiscard') : t('center.discard')}
                            disabled={busy}
                            onClick={() => discard(change.path)}
                          >
                            <RollbackIcon />
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
                {s.truncated && (
                  <div style={css.emptyNote}>{t('popup.changesTruncated').replace('{count}', String(s.changes.length))}</div>
                )}
              </>
            )}
        </>
    )
    : null

  /** 区块元素表：id → 已守卫内容（隐藏区块为 null，不占位）。 */
  const blockNodes: Record<PopupBlockId, JSX.Element | null> = {
    statusBar: blockStatusBar,
    branchCreate: blockBranchCreate,
    workRecord: blockWorkRecord,
    recentCommits: blockRecentCommits,
    changesList: blockChangesList,
  }

  return (
    <>
      {blockHeader}
      {blockNote}
      {normalizePopupOrder(settings.popupOrder).map((id) => (
        <Fragment key={id}>{blockNodes[id]}</Fragment>
      ))}
      <div style={css.footerRow}>
        <span style={css.checkedAt}>{t('popup.checkedAt').replace('{time}', new Date(s.checkedAt).toLocaleTimeString())}</span>
        <span style={css.footerActions}>
          <PopRefresher refresh={refresh} t={t} />
          <button type="button" className="dsh-git-ui__footer-primary" style={{ ...css.refreshButton, ...css.footerPrimary, padding: '4px 10px' }} onClick={openCenter}>
            {t('center.open')}
          </button>
        </span>
      </div>
    </>
  )
}

