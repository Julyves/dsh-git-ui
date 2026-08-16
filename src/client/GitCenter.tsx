/**
 * Git center — the IDE-style management panel for one session's repository.
 *
 * Phase 1 ships the Changes view: grouped file lists (staged / unstaged /
 * untracked) with per-file and bulk stage / unstage / discard actions, and a
 * commit box (message + optional selected paths). The panel is a platform
 * `Modal` (headless, width overridden) so it never participates in header
 * layout; operation results ride back through the controller and the view
 * updates from the returned snapshot.
 *
 * Discard is destructive (tracked changes only in Phase 1) and therefore
 * two-step: the button arms itself and requires a second click within 3s.
 */
import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitAction, GitActionResult, GitChange, GitSnapshot } from '../host/types.ts'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** One change-row action callback; all are disabled while busy. */
interface RowActions {
  readonly onToggle: (path: string) => void
  readonly onStage: (path: string) => void
  readonly onUnstage: (path: string) => void
  readonly onDiscard: (path: string) => void
}

export interface GitCenterProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly snapshot: GitSnapshot
  readonly run: (action: GitAction) => Promise<GitActionResult>
  readonly t: (key: GitKey) => string
}

type Feedback = { readonly kind: 'error'; readonly text: string } | null

/** One transient success toast (keyed by seq so repeats restart the cycle). */
interface ToastState {
  readonly text: string
  readonly seq: number
}

/** Change row with checkbox (commit selection) and per-file actions. */
function ChangeRow({
  change, checked, busy, actions, t,
}: {
  change: GitChange
  checked: boolean
  busy: boolean
  actions: RowActions
  t: (key: GitKey) => string
}): JSX.Element {
  const untracked = change.status === 'untracked'
  return (
    <div className="dsh-git-ui__row" style={css.centerRow}>
      <input
        type="checkbox"
        style={css.changeCheckbox}
        checked={checked}
        disabled={busy}
        onChange={() => { actions.onToggle(change.path) }}
        aria-label={change.path}
      />
      <span style={css.changeChip} title={change.status}>
        {CHIP_LETTERS[change.status] ?? '•'}
      </span>
      <span style={css.changePathText} title={change.path}>{change.path}</span>
      {change.staged
        ? <Button size="sm" disabled={busy} onClick={() => actions.onUnstage(change.path)}>{t('center.unstage')}</Button>
        : <Button size="sm" disabled={busy} onClick={() => actions.onStage(change.path)}>{t('center.stage')}</Button>}
      {!untracked && (
        <Button size="sm" disabled={busy} onClick={() => actions.onDiscard(change.path)}>{t('center.discard')}</Button>
      )}
    </div>
  )
}

const CHIP_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R',
  untracked: '?', conflicted: '!', typechange: 'T',
}

/**
 * The management panel. Rendered by GitPill inside the platform Modal; the
 * snapshot prop comes from the live controller view, so every successful
 * operation re-renders this component with fresh state.
 */
export function GitCenter({
  open, onClose, snapshot, run, t,
}: GitCenterProps): JSX.Element | null {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [armed, setArmed] = useState<string | 'all' | null>(null)

  // Auto-disarm the destructive confirm after 3s.
  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const staged = useMemo(() => snapshot.changes.filter((c) => c.staged), [snapshot])
  const unstaged = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked'), [snapshot])
  const untracked = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked'), [snapshot])
  const hasTrackedChanges = staged.length + unstaged.length > 0

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const doRun = async (action: GitAction, successText: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    const result = await run(action)
    setBusy(false)
    setArmed(null)
    if (result.ok) {
      setSelected(new Set())
      setMessage('')
      // Transient system toast (holds ~3s, fades, unmounts itself).
      setToast({ text: successText, seq: Date.now() })
    } else {
      // Persistent panel-level error banner with a dismiss button.
      setFeedback({ kind: 'error', text: result.error.message ?? result.error.code })
    }
  }

  const armDiscard = (target: string | 'all'): void => {
    setArmed((prev) => (prev === target ? null : target))
  }

  const discardTarget = (path: string): void => {
    if (armed === path) void doRun({ kind: 'discard', paths: [path] }, t('center.done'))
    else armDiscard(path)
  }

  const discardAll = (): void => {
    if (armed === 'all') void doRun({ kind: 'discard-all' }, t('center.done'))
    else armDiscard('all')
  }

  const commit = (): void => {
    const text = message.trim()
    if (text === '' || busy) return
    const paths = selected.size > 0 ? [...selected] : undefined
    void doRun({ kind: 'commit', message: text, ...(paths === undefined ? {} : { paths }) }, t('center.done'))
  }

  const actions: RowActions = {
    onToggle: toggle,
    onStage: (path) => void doRun({ kind: 'stage', paths: [path] }, t('center.done')),
    onUnstage: (path) => void doRun({ kind: 'unstage', paths: [path] }, t('center.done')),
    onDiscard: discardTarget,
  }

  return (
    <Modal open={open} onClose={onClose} title={t('center.title')} closeLabel={t('popup.refresh')} headless className="dsh-git-ui__center">
      <div style={css.centerShell}>
        <div style={css.centerHeader}>
          <h2 style={css.centerTitle} title={snapshot.root}>{snapshot.branch ?? '(detached)'} — {t('center.title')}</h2>
          <Button size="sm" onClick={onClose} aria-label={t('popup.refresh')}>✕</Button>
        </div>

        <div style={css.centerBody}>
          {feedback !== null && (
            <div style={css.feedbackError} role="alert">
              <span style={{ flex: 1 }}>{feedback.text}</span>
              <button type="button" style={css.feedbackClose} onClick={() => setFeedback(null)} aria-label={t('popup.refresh')}>✕</button>
            </div>
          )}

          <div style={css.toolRow}>
            <Button size="sm" disabled={busy || (unstaged.length === 0 && untracked.length === 0)} onClick={() => void doRun({ kind: 'stage-all' }, t('center.done'))}>
              {t('center.stageAll')}
            </Button>
            <Button size="sm" disabled={busy || staged.length === 0} onClick={() => void doRun({ kind: 'unstage-all' }, t('center.done'))}>
              {t('center.unstageAll')}
            </Button>
            <Button size="sm" disabled={busy || !hasTrackedChanges} onClick={discardAll}>
              {armed === 'all' ? t('center.confirmDiscard') : t('center.discardAll')}
            </Button>
          </div>

          {snapshot.changes.length === 0
            ? <div style={css.emptyNote}>{t('center.empty')}</div>
            : (
              <>
                {staged.length > 0 && <GroupedList title={t('center.staged')} changes={staged} checked={selected} busy={busy} actions={actions} t={t} />}
                {unstaged.length > 0 && <GroupedList title={t('center.unstaged')} changes={unstaged} checked={selected} busy={busy} actions={actions} t={t} />}
                {untracked.length > 0 && <GroupedList title={t('center.untracked')} changes={untracked} checked={selected} busy={busy} actions={actions} t={t} />}
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
            <span style={css.commitHint}>
              {selected.size > 0 ? t('center.commitSelected').replace('{count}', String(selected.size)) : t('center.commitHint')}
            </span>
            <Button variant="primary" size="sm" disabled={busy || message.trim() === ''} onClick={commit}>
              {busy ? t('center.busy') : t('center.commit')}
            </Button>
          </div>
        </div>
      </div>
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => setToast(null)} />
      )}
    </Modal>
  )
}

/** One group of change rows (staged / unstaged / untracked). */
function GroupedList({
  title, changes, checked, busy, actions, t,
}: {
  title: string
  changes: readonly GitChange[]
  checked: ReadonlySet<string>
  busy: boolean
  actions: RowActions
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <>
      <div style={css.groupTitle}>{title}</div>
      {changes.map((change) => (
        <ChangeRow
          key={change.path}
          change={change}
          checked={checked.has(change.path)}
          busy={busy}
          actions={actions}
          t={t}
        />
      ))}
    </>
  )
}
