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
import type { GitQueryOutcome, GitView } from './controller.ts'
import type { GitInjected } from '../contracts/client-platform.ts'
import { GitCenter } from './GitCenter.tsx'
import { fileIconForPath, FolderIcon, AlertIcon, CloseIcon, GearIcon, RollbackIcon, StageIcon, UnstageIcon, RecordIcon } from './icons.tsx'
import type { GitAction, GitActionResult, GitBranch, GitOperationErrorCode, GitQueryRequest, WorkEntry } from '../host/types.ts'
import type { GitKey } from './locales.ts'
import { SelectMenu } from './select-menu.tsx'
import { splitChangePath } from './file-tree.ts'
import { shouldClosePopup } from './popup-close.ts'
import { diffBaseOf } from './changes-diff.ts'
import { errorText, errorAction } from './error-text.ts'
import { useSettings } from './settings/use-settings.ts'
import { renderPill, chipLetter, popupBadgeTexts } from './pill-segments.tsx'
import { useTurnRecords } from './use-turn-records.ts'
import { latestWorkTurn, turnEntryCounts } from './work-record-meta.ts'
import { EntryRow } from './records/entry-row.tsx'
import { countUnseen, markSeen, readSeenAt } from './records/unread.ts'
import { applyAuthorOverrides, mergeOverrides, OVERRIDES_FILE, parseOverrides, serializeOverrides, setOverride, type AuthorOverrideMap } from './records/overrides.ts'
import type { GitUISettings } from '../contracts/settings.ts'
import type { GitCenterTab } from './GitCenter.tsx'
import type { TurnWorkRecord } from '../host/types.ts'
import { GitPopupBody } from './pill/popup/GitPopupBody.tsx'
import { DegradedPill } from './pill/popup/DegradedPill.tsx'
import { PopRefresher } from './pill/popup/PopRefresher.tsx'
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
export function GitPill({ sessionId, useGit, useSession, refresh, run, query, storageRead, storageWrite, t }: GitPillProps): JSX.Element | null {
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

  // 设置（插件级全局）；Pill 与弹窗展示按此切片。置于 records hook 之前(顺序依赖)。
  const uiSettings = useSettings()

  // Turn 工作记录:按快照刷新键拉取(轮询/手动刷新/操作后自动重拉)。
  // 数据**恒拉取**(复用快照缓存,0 git 命令)——设置开关只控制 pill 徽章与
  // 弹窗分组的显隐,不切断数据源:Git 中心「记录」Tab 是主动入口,恒可用
  // (蓝图意图;关闭开关的意义是"减少 pill 打扰",不是禁用功能)。
  // 拉取失败或未就绪 → records=null → 徽章与弹窗分组静默隐藏(确定降级)。
  const { records } = useTurnRecords(
    (q) => query(q),
    display.state === 'ready' ? display.snapshot.checkedAt : -1,
  )

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
  /** Git 中心初始 Tab：常规打开 = 变更；齿轮打开 = 设置；记录入口 = 记录。 */
  const [centerTab, setCenterTab] = useState<GitCenterTab>('changes')
  /** 工作记录已读时刻(未读徽章的增量基准;查看即刷新)。 */
  const [seenAt, setSeenAt] = useState(() => readSeenAt(sessionId))
  /** 人工改判归因(仓库级,overrides.json;一次加载,改动即持久化)。 */
  const [overrides, setOverrides] = useState<AuthorOverrideMap>({})
  /** 内存态 ref 镜像:reclassify 的异步写前合并要读「尚未落盘的最新意图」。 */
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides
  const overridesLoaded = useRef(false)
  useEffect(() => {
    if (overridesLoaded.current || display.state !== 'ready') return
    overridesLoaded.current = true
    void storageRead(OVERRIDES_FILE).then((raw) => setOverrides(parseOverrides(raw)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 首个就绪快照后加载一次
  }, [display.state])

  /** 改判一条归因:**写前合并**——磁盘(他实例的并发改判)∪ 本实例内存
 * (尚未落盘的连续快速改判)后再写,盲写会静默抹掉他人状态(P2-5);
 * 副作用独立于 setState updater(StrictMode 安全)。失败静默,内存态仍生效。 */
  const reclassify = (path: string, to: 'internal' | 'external'): void => {
    const root = display.state === 'ready' ? display.snapshot.root : ''
    void (async () => {
      const raw = await storageRead(OVERRIDES_FILE).catch(() => null)
      const next = setOverride(mergeOverrides(overridesRef.current, parseOverrides(raw)), root, path, to)
      setOverrides(next)
      await storageWrite(OVERRIDES_FILE, serializeOverrides(next)).catch(() => {})
    })()
  }

  /** 展示层记录 = host 记录 ∪ 人工改判(弹窗/记录页/未读计数统一走此视图)。 */
  const workspaceRoot = display.state === 'ready' ? display.snapshot.root : ''
  const viewRecords = records === null ? null : applyAuthorOverrides(records, workspaceRoot, overrides)

  /** 查看即已读:弹窗打开或 Git 中心停驻记录页时标记,未读徽章清零。 */
  const markWorkSeen = (): void => setSeenAt(markSeen(sessionId))
  useEffect(() => {
    if (open) markWorkSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 上升沿标记一次
  }, [open])
  useEffect(() => {
    if (centerOpen && centerTab === 'records') markWorkSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 记录页停驻上升沿标记
  }, [centerOpen, centerTab])

  /** 打开 Git 中心并定位到「记录」Tab（弹窗工作记录「全部 turn 记录」入口）。 */
  const openRecordsInCenter = (): void => {
    setCenterTab('records')
    setOpen(false)
    setPos(null)
    setCenterOpen(true)
  }

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

  const workWindow = latestWorkTurn(viewRecords)
  const { internal: internalCount, sibling: siblingCount, external: externalCount } = turnEntryCounts(workWindow)
  const unseenCount = uiSettings.pill.workRecord ? countUnseen(viewRecords, seenAt) : 0
  const showWorkBadge = uiSettings.pill.workRecord
    && (internalCount > 0 || siblingCount > 0 || externalCount > 0 || unseenCount > 0)
  const workBadgeTitle = () => {
    const lines: string[] = []
    if (unseenCount > 0) lines.push(t('work.unreadBadge').replace('{n}', String(unseenCount)))
    lines.push(t('work.badge').replace('{internal}', String(internalCount)).replace('{external}', String(externalCount)))
    if (workWindow !== undefined) {
      if (workWindow.internal.length > 0) lines.push(`${t('work.group.turnInternal')}: ${workWindow.internal.map((e) => e.path).join(', ')}`)
      if (workWindow.sibling.length > 0) lines.push(`${t('work.group.sibling')}: ${workWindow.sibling.map((e) => e.path).join(', ')}`)
      if (workWindow.external.length > 0) lines.push(`${t('work.group.external')}: ${workWindow.external.map((e) => e.path).join(', ')}`)
    }
    return lines.join('\n')
  }

  return (
    <span ref={wrapRef} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="dsh-git-ui__pill"
        style={css.pill}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${display.snapshot.root}\n${render.summary}${showWorkBadge ? `\n${workBadgeTitle()}` : ''}`}
      >
        {render.nodes}
        {showWorkBadge && (
          <span style={css.workBadges}>
            {unseenCount > 0 && (
              <span style={css.workBadgeUnread} title={t('work.unreadBadge').replace('{n}', String(unseenCount))}>
                {t('work.unreadShort').replace('{n}', String(unseenCount))}
              </span>
            )}
            {unseenCount === 0 && internalCount > 0 && (
              <span style={css.workBadgeInternal} title={t('work.group.turnInternal')}>
                <span style={css.workBadgeDotInternal} aria-hidden="true" />
                {t('work.badgeInternalShort').replace('{n}', String(internalCount))}
              </span>
            )}
            {unseenCount === 0 && siblingCount > 0 && (
              <span style={css.workBadgeSibling} title={t('work.group.sibling')}>
                <span style={css.workBadgeDotSibling} aria-hidden="true" />
                {t('work.badgeSiblingShort').replace('{n}', String(siblingCount))}
              </span>
            )}
            {unseenCount === 0 && externalCount > 0 && (
              <span style={css.workBadgeExternal} title={t('work.group.external')}>
                <span style={css.workBadgeDotExternal} aria-hidden="true" />
                {t('work.badgeExternalShort').replace('{n}', String(externalCount))}
              </span>
            )}
          </span>
        )}
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
            openRecords={openRecordsInCenter}
            openSettings={openSettingsInCenter}
            onOpenDiff={openDiffInCenter}
            run={run}
            query={query}
            records={viewRecords}
            onReclassify={reclassify}
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
        records={viewRecords}
        onReclassify={reclassify}
      />
    </span>
  )
}
