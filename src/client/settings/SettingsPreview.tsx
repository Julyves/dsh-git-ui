/**
 * 设置预览卡：按当前设置渲染一枚仿真 Pill（演示数据）。
 *
 * 与真实 Pill 共用 `renderPill()` 渲染管道——协议级保证「预览即所得」。
 * 使用固定演示快照（而非当前会话真实数据）：dirty/领先计数稳定，
 * 切换开关时每个片段的效果都清晰可见；真实快照在计数为 0 时无法演示
 * 徽章片段。
 */
import type { JSX } from 'react'
import type { GitSnapshot } from '../../host/types.ts'
import { renderPill, type T, type ReadyView } from '../pill-segments.tsx'
import type { PillSettings } from '../../contracts/settings.ts'
import * as css from '../styles.ts'
/** 演示快照：覆盖分支/游离/计数/领先的展示分支（固定值保证预览稳定）。 */
const DEMO_SNAPSHOT: GitSnapshot = {
  root: '~/projects/demo-repo',
  branch: 'main',
  head: 'a1b2c3d',
  unborn: false,
  dirty: true,
  staged: 2,
  modified: 1,
  untracked: 3,
  ahead: 1,
  behind: 2,
  lastCommit: null,
  recentCommits: [],
  changes: [],
  truncated: false,
  refreshIntervalMs: 30_000,
  watchVersion: 0,
  checkedAt: 0,
}

const DEMO_VIEW: ReadyView = { state: 'ready', snapshot: DEMO_SNAPSHOT }

export function SettingsPreview({
  settings, t,
}: {
  readonly settings: PillSettings
  readonly t: T
}): JSX.Element {
  const render = renderPill(DEMO_VIEW, settings, t)
  return (
    <section style={css.settingsPreview} aria-label={t('settings.preview')}>
      <div style={css.settingsPreviewBar}>
        <span style={css.settingsPreviewLabel}>{t('settings.preview')}</span>
        <span style={css.settingsPreviewNote}>{t('settings.preview.demo')}</span>
      </div>
      <div style={css.settingsPreviewStage}>
        <span className="dsh-git-ui__pill" style={{ ...css.pill, ...css.settingsPreviewPill }} aria-hidden="true">
          {render.nodes}
          {settings.workRecord && (
            <span style={css.workBadges}>
              <span style={css.workBadgeInternal}>
                <span style={css.workBadgeDotInternal} aria-hidden="true" />
                {t('work.badgeInternalShort').replace('{n}', '2')}
              </span>
              <span style={css.workBadgeExternal}>
                <span style={css.workBadgeDotExternal} aria-hidden="true" />
                {t('work.badgeExternalShort').replace('{n}', '1')}
              </span>
            </span>
          )}
        </span>
      </div>
    </section>
  )
}
