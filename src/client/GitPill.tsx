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
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitObservable, GitQueryOutcome, GitView } from './controller.ts'
import { GitCenter } from './GitCenter.tsx'
import { fileIconForPath, FolderIcon, RollbackIcon, StageIcon, UnstageIcon } from './icons.tsx'
import type { GitAction, GitActionResult, GitBranch, GitQueryRequest } from '../host/types.ts'
import type { GitKey } from './locales.ts'
import { SelectMenu } from './select-menu.tsx'
import { splitChangePath } from './file-tree.ts'
import { shouldClosePopup } from './popup-close.ts'
import * as css from './styles.ts'

// Inject the plugin's interaction styles once (idempotent, browser-only).
css.ensureGlobalCss()

/** Injected business face of the header utility entry. */
export interface GitInjected {
  hooks: {
    /** The owning Session's git view source. The slot runtime binds this
     * observable into the `useGit` selector hook the component consumes. */
    git: GitObservable<GitView>
  }
  /** Force an immediate re-check (same path as polling). */
  refresh: () => Promise<void>
  /** Execute one management action (host returns a fresh snapshot). */
  run: (action: GitAction) => Promise<GitActionResult>
  /** Run one read-only query (history / diff / show / branches). */
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
}

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

/** 状态字符映射（配色见 styles.chipStyles，全语义 token）。 */

const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

/** Format a count badge like `+2 −1 ?3` (staged / modified / untracked). */
function dirtyBadge(snapshot: GitView & { state: 'ready' }): string {
  const parts: string[] = []
  if (snapshot.snapshot.staged > 0) parts.push(`+${snapshot.snapshot.staged}`)
  if (snapshot.snapshot.modified > 0) parts.push(`−${snapshot.snapshot.modified}`)
  if (snapshot.snapshot.untracked > 0) parts.push(`?${snapshot.snapshot.untracked}`)
  return parts.join(' ')
}

/** Format ahead/behind like `↑1 ↓2`. */
function aheadBehind(snapshot: GitView & { state: 'ready' }): string {
  const parts: string[] = []
  if (snapshot.snapshot.ahead > 0) parts.push(`↑${snapshot.snapshot.ahead}`)
  if (snapshot.snapshot.behind > 0) parts.push(`↓${snapshot.snapshot.behind}`)
  return parts.join(' ')
}

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

/** The pill label parts: 分支名（可 ellipsis 收缩）+ 徽标（不截断保留）。 */
function pillParts(view: GitView & { state: 'ready' }, t: (key: GitKey) => string): { branch: string; badges: string[] } {
  const s = view.snapshot
  const branch = s.branch === null
    ? `(${t('pill.detached')}) · ${s.head ?? ''}`
    : (s.unborn ? `${s.branch} · ${t('pill.noCommits')}` : s.branch)
  const badges = [dirtyBadge(view), aheadBehind(view)].filter(Boolean)
  return { branch, badges }
}

/** Dimmed pill for degraded states. */
function DegradedPill({ label, title, t }: { label: string; title?: string; t: (key: GitKey) => string }): JSX.Element {
  void t
  return (
    <span className="dsh-git-ui__pill" style={css.pillDimmed} title={title} aria-label={label}>
      {label}
    </span>
  )
}

/**
 * Popup body (rendered inside the portaled card)。
 * 分支管理（切换/新建）已并入本组件：头部内联切换 + 新建行上提；
 * 变更行带 hover 内联操作（暂存/取消/丢弃两步）。
 */
function GitPopupBody({
  view, refresh, openCenter, run, query, t,
}: {
  view: GitView & { state: 'ready' }
  refresh: () => Promise<void>
  openCenter: () => void
  run: (action: GitAction) => Promise<GitActionResult>
  query: (query: GitQueryRequest['query']) => Promise<GitQueryOutcome>
  t: (key: GitKey) => string
}): JSX.Element {
  const now = Date.now()
  const s = view.snapshot
  const branchLabel = s.branch === null ? `(${t('pill.detached')})` : s.branch

  // 分支管理状态（自原 BranchQuickManage 并入）：切换（头部内联）+ 新建（上提）。
  const [branchData, setBranchData] = useState<{ current: string | null; local: readonly GitBranch[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  // 变更行丢弃两步确认：armed 记录待确认的路径，3s 自动解除。
  const [armed, setArmed] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    const outcome = await query({ kind: 'branches' })
    if (outcome.ok && outcome.value.kind === 'branches') {
      setBranchData({ current: outcome.value.current, local: outcome.value.local })
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, [])

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
    if (!result.ok) setNote(result.error.message ?? result.error.code)
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
      if (!switched.ok) setNote(switched.error.message ?? switched.error.code)
      setNewName('')
    } else {
      setNote(created.error.message ?? created.error.code)
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
    if (!result.ok) setNote(result.error.message ?? result.error.code)
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
          {branchData === null ? (
            <span style={css.popupHeaderBranch}>{branchLabel}</span>
          ) : (
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
          )}
          {s.unborn && <span style={css.popupBadge}>{t('pill.noCommits')}</span>}
          {s.dirty && <span style={css.popupBadge}>{dirtyBadge(view)}</span>}
          {(s.ahead > 0 || s.behind > 0) && <span style={css.popupBadge}>{aheadBehind(view)}</span>}
        </div>
        <div style={css.popupHeaderRoot} title={s.root}>
          <FolderIcon />
          <span style={css.popupHeaderRootText}>{s.root}</span>
        </div>
      </header>
      <div style={css.popupStatusBar}>
        {([
          ['popup.staged', s.staged], ['popup.modified', s.modified], ['popup.untracked', s.untracked],
        ] as const).map(([key, value]) => (
          <span key={key} style={css.popupStatItem}>
            <span style={css.popupStatValue}>{value}</span>
            <span style={css.popupStatLabel}>{t(key)}</span>
          </span>
        ))}
      </div>
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
      {note !== null && <div style={css.emptyNote} role="alert">{note}</div>}
      <div style={css.sectionTitle}>{t('popup.recentCommits')}</div>
      {s.recentCommits.length === 0
        ? <div style={css.emptyNote}>{t('popup.emptyCommits')}</div>
        : s.recentCommits.slice(0, 3).map((commit) => (
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
      <div style={css.sectionTitle}>{t('popup.changes')}</div>
      {s.changes.length === 0
        ? <div style={css.emptyNote}>{t('popup.empty')}</div>
        : (
          <>
            {s.changes.map((change) => {
              const { name, dir, isDir } = splitChangePath(change.path)
              const untracked = change.status === 'untracked'
              return (
                <div key={change.path} className="dsh-git-ui__row" style={css.changeRow}>
                  <span
                    style={{ ...css.changeChip, ...(css.chipStyles[change.status] ?? css.chipStyles.untracked) }}
                    title={change.status}
                  >
                    {CHIP_LETTERS[change.status] ?? '•'}
                  </span>
                  <span style={css.rowFileIcon} aria-hidden="true">
                    {isDir ? <FolderIcon /> : fileIconForPath(change.path)}
                  </span>
                  <span style={css.changeNamePop} title={change.path}>{name}</span>
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

  const dirty = display.snapshot.dirty
  const parts = pillParts(display, t)
  return (
    <span ref={wrapRef} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="dsh-git-ui__pill"
        style={css.pill}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${display.snapshot.root}\n${[parts.branch, ...parts.badges].filter(Boolean).join(' · ')}`}
      >
        <span style={dirty ? css.dotDirty : css.dot} aria-hidden="true" />
        <span style={css.pillBranch}>{parts.branch}</span>
        {parts.badges.length > 0 && <span style={css.pillBadges}>{parts.badges.join(' · ')}</span>}
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
            refresh={refresh}
            openCenter={() => { setOpen(false); setPos(null); setCenterOpen(true) }}
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
        snapshot={display.snapshot}
        run={run}
        query={query}
        t={t}
      />
    </span>
  )
}
