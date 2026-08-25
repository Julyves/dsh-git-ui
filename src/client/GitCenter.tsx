/**
 * Git center — the IDE-style management panel for one session's repository.
 *
 * Three tabs on a system-styled tab bar:
 *   Changes  — grouped lists (staged / unstaged / untracked) with per-file
 *              and bulk stage / unstage / discard, a commit box, and an
 *              inline diff preview for the selected file.
 *   History  — paginated commit list (50/page + load more) with a detail
 *              pane (metadata + file stats) and per-file commit diffs.
 *   Branches — local/remote branch lists, create-and-switch, switch, safe
 *              delete (two-step confirm).
 *
 * Feedback: successes are transient system Toasts; errors are a dismissible
 * in-panel banner. Discard/delete are destructive and require a second click
 * within 3s.
 *
 * 纯壳：tab 路由 + execute + 顶栏 + 三 panel 挂载。各 tab 实现拆至
 * center/changes/ 与 center/history/；共享类型/常量在 center/shared.ts。
 */
import { Fragment, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useUI } from '../contracts/ui-context.tsx'
import type { GitAction, GitActionResult } from '../host/types.ts'
import { errorText } from './error-text.ts'
import { CloseIcon, GearIcon, RecordIcon } from './icons.tsx'
import { RecordsTab } from './records/index.tsx'
import { SettingsTab } from './settings/SettingsTab.tsx'
import * as css from './styles.ts'
import { ChangesTab } from './center/changes/ChangesTab.tsx'
import { HistoryTab } from './center/history/HistoryTab.tsx'
import type { GitCenterProps, TabKey, Feedback, ToastState } from './center/shared.ts'

export type { GitCenterProps, GitCenterTab } from './center/shared.ts'


export function GitCenter({
  open, onClose, initialTab = 'changes', snapshot, run, query, t, openRequest = null, records = null, onReclassify,
}: GitCenterProps): JSX.Element | null {
  const { Modal, Toast } = useUI()
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 记录 Tab 跳转 Changes 的打开请求(仍变更条目点击)。 */
  const [recordOpenRequest, setRecordOpenRequest] = useState<{ path: string; base: 'worktree' | 'staged' } | null>(null)
  /** 记录 Tab 跳转 History 的定位请求(已提交条目点击 → 提交哈希)。
   * 对象态含 nonce:重复点击同一提交也产生新引用,重触发 HistoryTab 定位(H8)。 */
  const [commitRequest, setCommitRequest] = useState<{ hash: string; nonce: number } | null>(null)

  // 打开即定位（pill 齿轮 / 常规打开 / 变更文件直达）：open 上升沿重设 tab，
  // 而非依赖 initialTab 引用变化——连续两次齿轮打开时引用不变，需以 open 为触发。
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  // 打开定位请求（pill 点击变更文件）：切到 changes 标签，由 ChangesTab
  // 响应 openRequest 打开该文件对照。openRequest 对象引用变化即再次定位。
  useEffect(() => {
    if (openRequest !== null) setTab('changes')
  }, [openRequest])

  /** Execute a management action with shared busy/feedback/toast handling. */
  const execute = async (action: GitAction, successText: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setFeedback(null)
    const result = await run(action)
    setBusy(false)
    if (result.ok) {
      setToast({ text: successText, seq: Date.now() })
      return true
    }
    setFeedback({
      text: errorText(result.error.code, result.error.message, t),
      ...(result.error.message === undefined ? {} : { detail: result.error.message }),
    })
    return false
  }

  const tabs: Array<{ key: TabKey; label: string; icon?: JSX.Element; dividerBefore?: boolean }> = [
    { key: 'changes', label: t('center.changes') },
    { key: 'history', label: t('center.history') },
    { key: 'records', label: t('work.tab'), icon: <RecordIcon /> },
    // 偏好区：与功能 Tab 用发丝分隔线轻隔离（设置 = 非仓库操作）。
    { key: 'settings', label: t('settings.title'), icon: <GearIcon />, dividerBefore: true },
  ]

  /** Toast 通知通道：设置 Tab 的重置反馈等复用统一 toast。 */
  const notify = (text: string): void => setToast({ text, seq: Date.now() })

  /** 关闭:清空记录跳转请求,避免再次打开时残留定位。 */
  const closeCenter = (): void => {
    setRecordOpenRequest(null)
    setCommitRequest(null)
    onClose()
  }

  /** 顶栏右端的分支上下文胶囊：承接被移除标题行的分支信息（title 显示仓库根）。 */
  const branchLabel = snapshot.branch !== null ? snapshot.branch : `(${t('pill.detached')})`

  return (
    <Modal open={open} onClose={closeCenter} title={t('center.title')} closeLabel={t('center.close')} headless className="dsh-git-ui__center">
      <div style={css.centerShell}>
        {/* 顶栏 = 功能域：左 tab 组 + 右工具组（分支上下文 + 关闭），标题行已移除以让出内容区 */}
        <div style={css.topBar}>
          <div style={css.tabs} role="tablist">
            {tabs.map(({ key, label, icon, dividerBefore }) => (
              <Fragment key={key}>
                {dividerBefore === true && <span style={css.tabDivider} aria-hidden="true" />}
                <button
                  type="button"
                  role="tab"
                  id={`dsh-git-ui-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`dsh-git-ui-panel-${key}`}
                  className={`dsh-git-ui__tab${tab === key ? ' dsh-git-ui__tab--active' : ''}`}
                  style={tab === key ? { ...css.tab, ...css.tabActive } : css.tab}
                  onClick={() => setTab(key)}
                >
                  {icon !== undefined && <span style={css.tabIcon} aria-hidden="true">{icon}</span>}
                  {label}
                </button>
              </Fragment>
            ))}
          </div>
          <div style={css.tabsTrailing}>
            <span
              style={css.branchContextChip}
              title={snapshot.root}
              aria-label={`${t('center.currentBranch')}: ${branchLabel} · ${snapshot.root}`}
            >
              <span style={snapshot.dirty ? css.dotDirty : css.dot} aria-hidden="true" />
              <span style={css.branchContextName}>{branchLabel}</span>
            </span>
            <button
              type="button"
              className="dsh-git-ui__icon-btn"
              style={css.rowIconButton}
              title={t('center.close')}
              aria-label={t('center.close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div style={css.centerBody}>
          {feedback !== null && (
            <div style={css.feedbackError} role="alert" title={feedback.detail}>
              <span style={{ flex: 1 }}>{feedback.text}</span>
              <button type="button" style={css.feedbackClose} onClick={() => setFeedback(null)} aria-label={t('center.close')}>✕</button>
            </div>
          )}

          {/* 三标签保持挂载、display 切换：保留各自状态（选中/分页/分支列表），与 IDE 行为一致。 */}
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-changes"
            aria-labelledby="dsh-git-ui-tab-changes"
            style={tab === 'changes' ? { display: 'contents' } : { display: 'none' }}
          >
            <ChangesTab snapshot={snapshot} busy={busy} execute={execute} query={query} t={t} openRequest={recordOpenRequest ?? openRequest} />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-history"
            aria-labelledby="dsh-git-ui-tab-history"
            style={tab === 'history' ? { display: 'contents' } : { display: 'none' }}
          >
            <HistoryTab query={query} run={run} t={t} focusRef={commitRequest} />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-records"
            aria-labelledby="dsh-git-ui-tab-records"
            style={tab === 'records' ? { display: 'contents' } : { display: 'none' }}
          >
            <RecordsTab records={records} t={t}
              onOpenDiff={(path, base) => {
                setRecordOpenRequest({ path, base })
                setTab('changes')
              }}
              execute={execute}
              onOpenCommit={(hash) => {
                // nonce 保证重复点击同一提交也重触发定位(H8)。
                setCommitRequest({ hash, nonce: Date.now() })
                setTab('history')
              }}
              onReclassify={onReclassify}
            />
          </div>
          <div
            role="tabpanel"
            id="dsh-git-ui-panel-settings"
            aria-labelledby="dsh-git-ui-tab-settings"
            style={tab === 'settings' ? { display: 'contents' } : { display: 'none' }}
          >
            <SettingsTab t={t} notify={notify} />
          </div>
        </div>
      </div>
      {toast !== null && (
        <Toast key={toast.seq} text={toast.text} onDone={() => setToast(null)} />
      )}
    </Modal>
  )
}
