/**
 * 弹窗区块排序渲染测试：GitPopupBody 按 settings.popupOrder 组装内容区块。
 *
 * 静态渲染（react-dom/server）+ HTML 字符串断言：五个可排序区块以各区
 * 标志性文案定位，断言其出现顺序与设置一致；隐藏区块不渲染但仍占序。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitPopupBody } from '../../src/client/pill/popup/GitPopupBody.tsx'
import { UIPrimitivesProvider } from '../../src/contracts/ui-context.tsx'
import type { UIPrimitives } from '../../src/contracts/ui-primitives.ts'
import { DEFAULT_SETTINGS, type GitUISettings, type PopupBlockId } from '../../src/contracts/settings.ts'
import type { GitView, GitQueryOutcome } from '../../src/client/controller.ts'
import { zh } from '../../src/client/locales.ts'
import type { GitAction, GitActionResult, GitQueryRequest, TurnWorkRecord } from '../../src/host/types.ts'

const t = (key: keyof typeof zh): string => zh[key]

const ui: UIPrimitives = {
  Modal: (props) => (props.open ? <div>{props.children}</div> : null),
  Button: (props) => <button type="button">{props.children}</button>,
  Toast: () => null,
}

const run = async (_a: GitAction): Promise<GitActionResult> => ({ ok: false, error: { code: 'git-error', message: 'stub' } })
const query = async (q: GitQueryRequest['query']): Promise<GitQueryOutcome> =>
  q.kind === 'branches'
    ? { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [], remote: [] } }
    : { ok: false, message: 'stub' }

const VIEW: GitView & { state: 'ready' } = {
  state: 'ready',
  snapshot: {
    root: '~/p/demo', branch: 'main', head: 'a1b2c3d', unborn: false,
    dirty: true, staged: 1, modified: 2, untracked: 0, ahead: 0, behind: 0,
    lastCommit: null,
    recentCommits: [{ hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', shortHash: 'aaaa111', subject: 's1', author: 'a', dateIso: '2026-01-01T00:00:00Z' }],
    changes: [{ path: 'src/a.ts', status: 'modified', staged: false, isDirectory: false }],
    truncated: false, refreshIntervalMs: 30_000, checkedAt: 0,
  },
}

/** 空记录数组：workRecord 区块渲染（空态 + 入口），不抛错。 */
const RECORDS: readonly TurnWorkRecord[] = []

/** 区块 → 标志性文案（HTML 内唯一定位）。 */
const MARKERS: Record<PopupBlockId, string> = {
  statusBar: zh['popup.staged'],
  branchCreate: zh['center.branchName'],
  workRecord: zh['work.section'],
  recentCommits: zh['popup.recentCommits'],
  changesList: zh['popup.changes'],
}

function render(order: readonly PopupBlockId[], settings?: Partial<GitUISettings>): string {
  const s: GitUISettings = { ...DEFAULT_SETTINGS, ...settings, popupOrder: order }
  return renderToStaticMarkup(
    <UIPrimitivesProvider value={ui}>
      <GitPopupBody
        view={VIEW} settings={s} refresh={async () => {}}
        openCenter={() => {}} openRecords={() => {}} openSettings={() => {}}
        onOpenDiff={() => {}} onOpenCommit={() => {}} records={RECORDS} onReclassify={() => {}}
        run={run} query={query} t={t}
      />
    </UIPrimitivesProvider>,
  )
}

describe('GitPopupBody — 区块按序渲染', () => {
  it('默认序：状态条 → 新建分支 → 工作记录 → 最近提交 → 变更列表', () => {
    const html = render(DEFAULT_SETTINGS.popupOrder)
    const positions = DEFAULT_SETTINGS.popupOrder.map((id) => html.indexOf(MARKERS[id]))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('自定义序（变更列表提前）：HTML 顺序跟随设置', () => {
    const order: readonly PopupBlockId[] = ['changesList', 'statusBar', 'branchCreate', 'workRecord', 'recentCommits']
    const html = render(order)
    const positions = order.map((id) => html.indexOf(MARKERS[id]))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('隐藏区块不渲染但保留在序列中（其余区块仍按序）', () => {
    // 状态条关 + 最近提交 0：两个区块的标志文案消失。
    const s: Partial<GitUISettings> = { popup: { ...DEFAULT_SETTINGS.popup, statusBar: false, recentCommits: 0 } }
    const html = render(DEFAULT_SETTINGS.popupOrder, s)
    expect(html.includes(MARKERS.statusBar)).toBe(false)
    expect(html.includes(MARKERS.recentCommits)).toBe(false)
    // 其余三个仍按默认相对序出现。
    const rest: readonly PopupBlockId[] = ['branchCreate', 'workRecord', 'changesList']
    const positions = rest.map((id) => html.indexOf(MARKERS[id]))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('工作记录区块随 popup.workRecord 隐藏（与 pill 徽章分离治理）', () => {
    const s: Partial<GitUISettings> = { popup: { ...DEFAULT_SETTINGS.popup, workRecord: false } }
    const html = render(DEFAULT_SETTINGS.popupOrder, s)
    expect(html.includes(MARKERS.workRecord)).toBe(false)
  })

  it('pill 徽章关闭不再隐藏弹窗区块（v5 分离：两开关独立）', () => {
    const s: Partial<GitUISettings> = { pill: { ...DEFAULT_SETTINGS.pill, workRecord: false } }
    const html = render(DEFAULT_SETTINGS.popupOrder, s)
    // pill 关、popup 开 → 弹窗区块仍在场。
    expect(html.includes(MARKERS.workRecord)).toBe(true)
  })

  it('含未知 id 的序被消毒（缺块补齐，未知剔除，不抛错）', () => {
    const html = render(['changesList', 'bogus'] as unknown as readonly PopupBlockId[])
    // 五个区块全部在场（默认序补齐缺失四个）。
    for (const id of Object.keys(MARKERS) as PopupBlockId[]) {
      expect(html.includes(MARKERS[id])).toBe(true)
    }
  })
})
