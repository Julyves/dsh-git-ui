/**
 * Git status pill + popup. Consumes the injected per-session controller
 * through the framework-standard observable shape: the slot runtime binds the
 * inject face's `hooks.git` observable into a `useGit` selector hook (see
 * bindInjectHooks in dsh-client-web-react), so the component reads the view
 * with `useGit()` instead of subscribing manually. Renders nothing for
 * cold/no-cwd states and a dimmed placeholder for degraded states.
 *
 * Layout contract: the popup is a fixed-position card portaled to
 * document.body and anchored to the wrapper's rect — exactly the machinery
 * the host's Menu/HoverCard use. It never participates in header layout, so
 * opening it cannot stretch the header.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { completedTurnCount, type TurnSignalSnapshot } from './turn-signal.ts'
import { useUI } from '../contracts/ui-context.tsx'
import type { GitObservable, GitQueryOutcome, GitView } from './controller.ts'
import type { GitInjected } from '../contracts/client-platform.ts'
import { GitCenter } from './GitCenter.tsx'
import { fileIconForPath, FolderIcon, AlertIcon, CloseIcon, GearIcon, RollbackIcon, StageIcon, UnstageIcon } from './icons.tsx'
import type { GitAction, GitActionResult, GitBranch, GitOperationErrorCode, GitQueryRequest } from '../host/types.ts'
import type { GitKey } from './locales.ts'
import { SelectMenu } from './select-menu.tsx'
import { splitChangePath } from './file-tree.ts'
import { shouldClosePopup } from './popup-close.ts'
import { diffBaseOf } from './changes-diff.ts'
import { errorText, errorAction } from './error-text.ts'
import { useSettings } from './settings/use-settings.ts'
import { renderPill, chipLetter, popupBadgeTexts } from './pill-segments.tsx'
import type { GitUISettings } from '../contracts/settings.ts'
import * as css from './styles.ts'

// Inject the plugin's interaction styles once (idempotent, browser-only).
css.ensureGlobalCss()

// Re-export for backward compatibility
export type { GitInjected } from '../contracts/client-platform.ts'

/** Selector hook shape the slot runtime binds from `hooks.git`. */
export type UseGit = <S = GitView>(
  selector?: (view: GitView) => S,
  equality?: (a: S, b: S) => boolean,
) => S

export type { TurnSignalSnapshot } from './turn-signal.ts'

/** Full props of the git pill entry (framework kit + our inject + locale). */
export interface GitPillProps extends GitInjected {
  /** Session scope identity from the standard session kit. */
  readonly sessionId: string
  /** Selector hook bound from `hooks.git` by the slot runtime. */
  readonly useGit: UseGit
  /** Standard session kit selector hook (narrowed to the turn signal). */
  readonly useSession: <S>(selector: (snapshot: TurnSignalSnapshot) => S) => S
  /** Namespace-bound dictionary accessor. */
  readonly t: (key: GitKey) => string
}

/** 状态字符映射（配色见 styles.chipStyles，全语义 token）。
 * 统一由 pill-segments.chipLetter 派生（协议单一来源）。 */

/** Short relative time from an ISO date, localized through dictionary templates. */
function timeAgo(iso: string, now: number, t: (key: GitKey) => string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  const fill = (template: GitKey, n: number): string => t(template).replace('{n}', String(n))
  if (seconds < 60) return t('time.justNow')
  if (seconds < 3600) return fill('time.minutesAgo', Math.floor(seconds / 60))
  if (seconds < 86_400) return fill('time.hoursAgo', Math.floor(seconds / 3600))
  return fill('time.daysAgo', Math.floor(seconds / 86_400))
}

/** Dimmed pill for degraded states（弱化图标锚点 + 说明文字）。 */
function DegradedPill({ label, title, t }: { label: string; title?: string; t: (key: GitKey) => string }): JSX.Element {
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
function GitPopupBody({
  view, settings, refresh, openCenter, openSettings, onOpenDiff, run, query, t,
}: {
  view: GitView & { state: 'ready' }
  settings: GitUISettings
  refresh: () => Promise<void>
  openCenter: () => void
  /** 打开 Git 中心并定位到设置页。 */
  openSettings: () => void
  /** 变更文件点击：打开 Git 中心并定位该文件的对照视图。 */
  onOpenDiff: (path: string, base: 'worktree' | 'staged') => void
  run: (action: GitAction) => Promise<GitActionResult>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
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

  return (
    <>
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
      {settings.popup.statusBar && (
        <div style={css.popupStatusBar}>
          {([
            ['popup.staged', s.staged], ['popup.modified', s.modified], ['popup.untracked', s.untracked],
          ] as const).map(([key, value]) => (
            <span key={key} style={css.popupStatItem}>
              <span style={css.popupStatValue}>{value}</span>
              <span style={css.popupStatLabel}>{t(key)}</span>
            </span>
          ))}
          {s.ahead > 0 && (
            <span style={css.popupStatItem}>
              <span style={css.popupStatValue}>↑{s.ahead}</span>
              <span style={css.popupStatLabel}>{t('popup.ahead')}</span>
            </span>
          )}
          {s.behind > 0 && (
            <span style={css.popupStatItem}>
              <span style={css.popupStatValue}>↓{s.behind}</span>
              <span style={css.popupStatLabel}>{t('popup.behind')}</span>
            </span>
          )}
        </div>
      )}
      {settings.popup.branchCreate && (
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
      )}
      {note !== null && (
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
      )}
      {settings.popup.recentCommits > 0 && (
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
              <div key={commit.hash} className="dsh-git-ui__row" style={css.commitRow}>
                <div style={css.commitSubjectPop} title={commit.subject}>{commit.subject}</div>
                <div style={css.commitMetaLine}>
                  <span style={css.commitHash}>{commit.shortHash}</span>
                  <span style={css.commitDot}>·</span>
                  <span style={css.commitMeta}>{commit.author}</span>
                  <span style={css.commitDot}>·</span>
                  <span style={css.commitMeta}>{timeAgo(commit.dateIso, now, t)}</span>
                </div>
              </div>
            ))}
        </>
      )}
      {settings.popup.changesList && (
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
                          style={css.changeNamePopBtn}
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
                          style={css.changeNamePopBtn}
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
      )}
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

/** The popup refresh verb (kept as its own component so it may own state). */
function PopRefresher({ refresh, t }: { refresh: () => Promise<void>; t: (key: GitKey) => string }): JSX.Element {
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

// Popup geometry (matches the host Menu/HoverCard portal pattern).
const POPUP_WIDTH = 340
const POPUP_MAX_HEIGHT = 420
const POPUP_GAP = 6
const POPUP_GUTTER = 6
const VIEW_GUTTER = 8

/**
 * The header utility entry: a branch pill that opens a portaled detail popup
 * and the Git center management panel.
 */
export function GitPill({ useGit, useSession, refresh, run, query, t }: GitPillProps): JSX.Element | null {
  // The selector hook requires a selector function (with-selector calls it
  // unconditionally); identity selection reads the whole view snapshot.
  const view = useGit((view) => view)
  // Last ready snapshot: while a refresh is in flight the controller reports
  // 'loading'; render the previous content instead of unmounting (a null
  // here unmounts the whole entry and makes sibling utilities in the same
  // seat flicker on every poll).
  const lastReady = useRef<GitView & { state: 'ready' } | null>(null)
  if (view.state === 'ready') lastReady.current = view
  const display: GitView = view.state === 'loading' && lastReady.current !== null ? lastReady.current : view

  // Best-effort activity trigger: an agent turn completing is the most
  // likely moment the working tree changed, so refresh right away instead of
  // waiting for the next poll. Polling stays the fallback (external edits,
  // window-slot misses). The ref starts at the CURRENT count so the mount
  // kick (below) is not duplicated; a session switch remounts and resets it.
  const turnCount = useSession((s) => completedTurnCount(s))
  const lastTurnRef = useRef(turnCount)
  useEffect(() => {
    if (turnCount <= lastTurnRef.current) return
    lastTurnRef.current = turnCount
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is per-session stable by contract.
  }, [turnCount])

  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [centerOpen, setCenterOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  /** 从 pill 变更行点击「打开 Git 中心并定位该文件 diff」的请求。 */
  const [centerRequest, setCenterRequest] = useState<{ path: string; base: 'worktree' | 'staged' } | null>(null)
  /** Git 中心初始 Tab：常规打开 = 变更；齿轮打开 = 设置。 */
  const [centerTab, setCenterTab] = useState<'changes' | 'settings'>('changes')
  /** 设置（插件级全局）；Pill 与弹窗展示按此切片。 */
  const uiSettings = useSettings()

  /** 打开 Git 中心并直接定位到该文件的对照视图（关 popup、切 changes 标签、查询 diff）。 */
  const openDiffInCenter = (path: string, base: 'worktree' | 'staged'): void => {
    setCenterTab('changes')
    setCenterRequest({ path, base })
    setOpen(false)
    setPos(null)
    setCenterOpen(true)
  }

  /** 打开 Git 中心（默认变更页）。 */
  const openCenter = (): void => {
    setCenterTab('changes')
    setOpen(false)
    setPos(null)
    setCenterOpen(true)
  }

  /** 打开 Git 中心并定位设置页（弹窗齿轮入口）。 */
  const openSettingsInCenter = (): void => {
    setCenterTab('settings')
    setOpen(false)
    setPos(null)
    setCenterOpen(true)
  }

  useEffect(() => {
    // First mount only: kick the controller once (single-flight; a cold
    // controller loads, a no-cwd controller retries). The inject face is
    // stable per session, so the controller must not be re-kicked on
    // re-renders — polling takes over after the first snapshot.
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only kick; refresh is per-session stable by contract.
  }, [])

  // Anchor the popup to the wrapper rect; re-place on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const wrapper = wrapRef.current
    if (wrapper === null) return
    const place = (): void => {
      const r = wrapper.getBoundingClientRect()
      const left = Math.max(VIEW_GUTTER, Math.min(r.right - POPUP_WIDTH, window.innerWidth - POPUP_WIDTH - VIEW_GUTTER))
      const below = r.bottom + POPUP_GAP
      const top = (below + POPUP_MAX_HEIGHT > window.innerHeight - VIEW_GUTTER)
        ? Math.max(VIEW_GUTTER, r.top - POPUP_MAX_HEIGHT - POPUP_GUTTER)
        : below
      setPos({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Reconcile a popup that opened upward with its measured height.
  useLayoutEffect(() => {
    if (!open || pos === null) return
    const h = popRef.current?.offsetHeight ?? POPUP_MAX_HEIGHT
    if (pos.top + h > window.innerHeight - VIEW_GUTTER) {
      setPos({ left: pos.left, top: Math.max(VIEW_GUTTER, window.innerHeight - h - VIEW_GUTTER) })
    }
  }, [open, pos])

  // Close on outside press or Escape (the popup is portaled to body, so the
  // wrapper ref can't cover it — check the card ref explicitly too).
  useEffect(() => {
    if (!open) return
    const close = (): void => { setOpen(false); setPos(null) }
    const onDown = (e: MouseEvent): void => {
      if (shouldClosePopup(e.target, wrapRef.current, popRef.current)) close()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (display.state === 'cold' || display.state === 'no-cwd') return null
  if (display.state === 'loading') {
    // First load only: nothing to show yet.
    return null
  }
  if (display.state === 'error') {
    if (display.error.code === 'not-a-git-repo') {
      return <DegradedPill label={t('pill.noRepo')} t={t} />
    }
    return (
      <DegradedPill
        label={t('pill.unavailable')}
        title={display.error.code === 'git-unavailable' ? display.error.detail : display.error.code}
        t={t}
      />
    )
  }

  const render = renderPill(display, uiSettings.pill, t)
  return (
    <span ref={wrapRef} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="dsh-git-ui__pill"
        style={css.pill}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${display.snapshot.root}\n${render.summary}`}
      >
        {render.nodes}
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={popRef}
          className="dsh-git-ui__pop"
          style={{ ...css.popup, top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={t('popup.title')}
        >
          <GitPopupBody
            view={display}
            settings={uiSettings}
            refresh={refresh}
            openCenter={openCenter}
            openSettings={openSettingsInCenter}
            onOpenDiff={openDiffInCenter}
            run={run}
            query={query}
            t={t}
          />
        </div>,
        document.body,
      )}
      <GitCenter
        open={centerOpen}
        onClose={() => setCenterOpen(false)}
        initialTab={centerTab}
        snapshot={display.snapshot}
        run={run}
        query={query}
        t={t}
        openRequest={centerRequest}
      />
    </span>
  )
}
