/**
 * Git status pill + popup. Consumes the injected per-session controller
 * through the framework-standard observable shape (useSyncExternalStore), so
 * no framework hook kit is needed. Renders nothing for cold/no-cwd states and
 * a dimmed placeholder for degraded states.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import type { GitObservable, GitView } from './controller.ts'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** Injected business face of the header utility entry. */
export interface GitInjected {
  hooks: {
    /** The owning Session's git view, shared by every mount of this entry. */
    git: GitObservable<GitView> & { ensure(): void }
  }
  /** Force an immediate re-check (same path as polling). */
  refresh: () => Promise<void>
}

/** Full props of the git pill entry (framework kit + our inject + locale). */
export interface GitPillProps extends GitInjected {
  /** Session scope identity from the standard session kit. */
  readonly sessionId: string
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
    <span style={css.pillDimmed} title={title} aria-label={label}>
      {label}
    </span>
  )
}

/** The popup panel: root, counts, commits, changes, refresh. */
function GitPopup({
  view, refresh, t,
}: {
  view: GitView & { state: 'ready' }
  refresh: () => Promise<void>
  t: (key: GitKey) => string
}): JSX.Element {
  const now = Date.now()
  const s = view.snapshot
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = (): void => {
    if (refreshing) return
    setRefreshing(true)
    void refresh().finally(() => setRefreshing(false))
  }
  return (
    <div style={css.popup} role="dialog" aria-label={t('popup.title')}>
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
                  style={{ ...css.changeChip, background: CHIP_COLORS[change.status] ?? '#888', color: '#fff' }}
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
        <button type="button" onClick={onRefresh} disabled={refreshing} style={{ fontSize: 12 }}>
          {refreshing ? '…' : t('popup.refresh')}
        </button>
      </div>
    </div>
  )
}

/** The header utility entry: a branch pill that opens the detail popup. */
export function GitPill({ hooks, refresh, t }: GitPillProps): JSX.Element | null {
  const view = useSyncExternalStore(hooks.git.subscribe, hooks.git.getSnapshot)
  useEffect(() => {
    hooks.git.ensure()
  }, [hooks.git])
  const [open, setOpen] = useState(false)

  if (view.state === 'cold' || view.state === 'no-cwd') return null
  if (view.state === 'loading') {
    // Keep the previous content while refreshing; nothing to show on first load.
    return null
  }
  if (view.state === 'error') {
    if (view.error.code === 'not-a-git-repo') {
      return <DegradedPill label={t('pill.noRepo')} t={t} />
    }
    return (
      <DegradedPill
        label={t('pill.unavailable')}
        title={view.error.code === 'git-unavailable' ? view.error.detail : view.error.code}
        t={t}
      />
    )
  }

  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        style={css.pill}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${view.snapshot.root}\n${pillLabel(view, t)}`}
      >
        ⎇ {pillLabel(view, t)}
      </button>
      {open && <GitPopup view={view} refresh={refresh} t={t} />}
    </span>
  )
}
