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
import type { GitObservable, GitView } from './controller.ts'
import type { GitKey } from './locales.ts'
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

/** Status chip colors for the changed-file list. */
const CHIP_COLORS: Record<string, string> = {
  added: '#2e7d32',
  modified: '#b26a00',
  deleted: '#c62828',
  renamed: '#1565c0',
  untracked: '#6a6a6a',
  conflicted: '#d32f2f',
  typechange: '#7b1fa2',
}

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

/** The pill label for a ready snapshot. */
function pillLabel(view: GitView & { state: 'ready' }, t: (key: GitKey) => string): string {
  const s = view.snapshot
  const branch = s.branch === null
    ? `(${t('pill.detached')}) · ${s.head ?? ''}`
    : s.branch
  const base = s.unborn ? `${branch} · ${t('pill.noCommits')}` : branch
  const badge = dirtyBadge(view)
  const ahead = aheadBehind(view)
  return [base, badge, ahead].filter(Boolean).join(' · ')
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

/** Popup body (rendered inside the portaled card): root, counts, commits, changes, refresh. */
function GitPopupBody({
  view, refresh, t,
}: {
  view: GitView & { state: 'ready' }
  refresh: () => Promise<void>
  t: (key: GitKey) => string
}): JSX.Element {
  const now = Date.now()
  const s = view.snapshot
  return (
    <>
      <h4 style={css.popupTitle}>{t('popup.title')}</h4>
      <div style={css.rootLine} title={s.root}>{s.root}</div>
      <div style={css.countGrid}>
        {([
          ['popup.staged', s.staged], ['popup.modified', s.modified], ['popup.untracked', s.untracked],
          ['popup.ahead', s.ahead], ['popup.behind', s.behind],
        ] as const).map(([key, value]) => (
          <div key={key} style={css.countCell}>
            <div style={css.countValue}>{value}</div>
            <div style={css.countLabel}>{t(key)}</div>
          </div>
        ))}
      </div>
      <div style={css.sectionTitle}>{t('popup.recentCommits')}</div>
      {s.recentCommits.length === 0
        ? <div style={css.emptyNote}>{t('popup.emptyCommits')}</div>
        : s.recentCommits.map((commit) => (
          <div key={commit.hash} style={css.commitRow}>
            <span style={css.commitHash}>{commit.shortHash}</span>
            <span style={css.commitSubject} title={commit.subject}>{commit.subject}</span>
            <span style={css.commitMeta}>{commit.author} · {timeAgo(commit.dateIso, now, t)}</span>
          </div>
        ))}
      <div style={css.sectionTitle}>{t('popup.changes')}</div>
      {s.changes.length === 0
        ? <div style={css.emptyNote}>{t('popup.empty')}</div>
        : (
          <>
            {s.changes.map((change) => (
              <div key={change.path} style={css.changeRow}>
                <span
                  style={{ ...css.changeChip, background: CHIP_COLORS[change.status] ?? '#888' }}
                  title={change.status}
                >
                  {CHIP_LETTERS[change.status] ?? '•'}
                </span>
                <span style={css.changePath} title={change.path}>{change.path}</span>
              </div>
            ))}
            {s.truncated && (
              <div style={css.emptyNote}>{t('popup.changesTruncated').replace('{count}', String(s.changes.length))}</div>
            )}
          </>
        )}
      <div style={css.footerRow}>
        <span style={css.checkedAt}>{t('popup.checkedAt').replace('{time}', new Date(s.checkedAt).toLocaleTimeString())}</span>
        <PopRefresher refresh={refresh} t={t} />
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
 * The header utility entry: a branch pill that opens a portaled detail popup.
 */
export function GitPill({ useGit, useSession, refresh, t }: GitPillProps): JSX.Element | null {
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
      const target = e.target as Node
      if (wrapRef.current?.contains(target) ?? false) return
      if (popRef.current?.contains(target) ?? false) return
      close()
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
  return (
    <span ref={wrapRef} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="dsh-git-ui__pill"
        style={css.pill}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${display.snapshot.root}\n${pillLabel(display, t)}`}
      >
        <span style={dirty ? css.dotDirty : css.dot} aria-hidden="true" />
        <span>{pillLabel(display, t)}</span>
      </button>
      {open && pos !== null && createPortal(
        <div
          ref={popRef}
          className="dsh-git-ui__pop"
          style={{ ...css.popup, top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={t('popup.title')}
        >
          <GitPopupBody view={display} refresh={refresh} t={t} />
        </div>,
        document.body,
      )}
    </span>
  )
}
