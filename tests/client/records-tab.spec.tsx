/**
 * RecordsTab 结构级组件测试（react-dom/server 静态渲染，node 环境即可）。
 *
 * 回归目标（2026-08-24 bug）：过滤（如「外部」）无结果时旧实现**提前 return
 * 空态**，把含过滤按钮的工具栏一并丢弃——用户被卡死在空态页无法切换过滤。
 * 修复后工具栏恒渲染；空态只在内容区呈现，并按原因区分文案。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordsTab } from '../../src/client/records/index.tsx'
import { zh } from '../../src/client/locales.ts'
import type { TurnWorkRecord, WorkEntry } from '../../src/host/types.ts'

/** 翻译桩：直接读 zh 字典（键集合与 GitKey 同源）。 */
const t = (key: keyof typeof zh): string => zh[key]

/** 构造一个 turn（可覆盖）。 */
function turn(overrides: Partial<TurnWorkRecord>): TurnWorkRecord {
  return {
    turn: 1, startAt: 0, endAt: 1_000_000, hasWork: true, narrative: null, internal: [], sibling: [], external: [],
    ...overrides,
  }
}

/** 一条工作条目。 */
function entry(path: string, state: WorkEntry['state'] = 'dirty'): WorkEntry {
  return { path, status: 'modified', state, firstSeenAt: 0 }
}

/** 渲染 RecordsTab 为静态 HTML 字符串。 */
function render(records: readonly TurnWorkRecord[] | null, initialFilter: 'all' | 'internal' | 'sibling' | 'external' = 'all'): string {
  return renderToStaticMarkup(
    <RecordsTab records={records} t={t} onOpenDiff={() => {}} initialFilter={initialFilter} />,
  )
}

describe('RecordsTab — 过滤空态不卡死（回归）', () => {
  it('过滤无结果时：工具栏与三个过滤按钮仍渲染，可切换退出', () => {
    // 只有 internal 条目；切到「外部」过滤 → 无结果
    const records = [turn({ turn: 1, internal: [entry('src/a.ts')] })]
    const html = render(records, 'external')

    // 空态文案（区分于「无时段」）
    expect(html).toContain(t('work.emptyFiltered'))
    expect(html).not.toContain(t('work.emptySessions'))

    // 三个过滤按钮（退出通道）全部在场
    expect(html).toContain(t('work.filter.all'))
    expect(html).toContain(t('work.group.internal'))
    expect(html).toContain(t('work.group.sibling'))
    expect(html).toContain(t('work.group.external'))
    // 「外部」为激活态（aria-pressed）
    expect(html).toContain('aria-pressed="true"')
    // 摘要仍显示（会话级统计不随过滤丢失；模板占位符已被替换）
    expect(html).toContain('1 个时段')
  })

  it('过滤无结果时点「全部」可恢复时段列表（按钮可交互路径存在）', () => {
    const records = [turn({ turn: 1, internal: [entry('src/a.ts')] })]
    // 初始「外部」→ 空态；但「全部」按钮在场意味着用户可点击退出
    const html = render(records, 'external')
    expect(html).toContain('>全部<')
  })

  it('无任何时段时：显示「还没有工作时段」但工具栏仍在', () => {
    const records = [turn({ turn: 1, hasWork: false })]
    const html = render(records)

    expect(html).toContain(t('work.emptySessions'))
    // 工具栏（摘要 + 过滤）不被空态吞掉
    expect(html).toContain(t('work.filter.all'))
    expect(html).toContain(t('work.group.external'))
  })

  it('records 未就绪（null）时显示加载失败态', () => {
    const html = render(null)
    expect(html).toContain(t('work.loadFailed'))
  })
})

describe('RecordsTab — 正常展示', () => {
  it('全部过滤下渲染时段卡片与展开条目（最近时段默认展开）', () => {
    const records = [turn({
      turn: 1,
      internal: [entry('src/a.ts')],
      sibling: [entry('gen/c.ts')],
      external: [entry('docs/b.md')],
    })]
    const html = render(records)

    expect(html).toContain('src/a.ts')
    expect(html).toContain('gen/c.ts')
    expect(html).toContain('docs/b.md')
    // 三个分组标题在场（本会话 / 其他会话 / 外部）
    expect(html).toContain(t('work.group.internal'))
    expect(html).toContain(t('work.group.sibling'))
    expect(html).toContain(t('work.group.external'))
  })

  it('「其他会话」过滤下仅保留含 sibling 条目的时段', () => {
    const records = [
      turn({ turn: 1, internal: [entry('src/a.ts')] }),
      turn({ turn: 2, startAt: 2_000_000, endAt: 3_000_000, sibling: [entry('gen/c.ts')] }),
    ]
    const html = render(records, 'sibling')
    expect(html).toContain('gen/c.ts')
    expect(html).not.toContain('src/a.ts')
  })
})

describe('RecordsTab — 任务叙事', () => {
  it('时段卡片头部渲染用户指令摘要(叙事优先于时间窗)', () => {
    const records = [turn({ turn: 1, narrative: '修复登录超时', internal: [entry('src/a.ts')] })]
    const html = render(records)
    expect(html).toContain('修复登录超时')
  })
})

describe('RecordsTab — 时段批量暂存（B1 行动闭环）', () => {
  it('execute 注入且存在仍变更条目时渲染「暂存 AI 变更 / 暂存全部」操作条', () => {
    const records = [turn({
      turn: 1,
      internal: [entry('src/a.ts')],
      sibling: [entry('gen/c.ts')],
      external: [entry('docs/b.md')],
    })]
    const html = renderToStaticMarkup(
      <RecordsTab records={records} t={t} onOpenDiff={() => {}} execute={async () => true} />,
    )
    expect(html).toContain(t('work.stage.ai'))
    expect(html).toContain(t('work.stage.all'))
  })

  it('无 execute 注入时不渲染操作条（测试/降级形态一致）', () => {
    const records = [turn({ turn: 1, internal: [entry('src/a.ts')] })]
    const html = render(records)
    expect(html).not.toContain(t('work.stage.ai'))
  })

  it('全部条目已提交（无 dirty）时不渲染操作条', () => {
    const records = [turn({ turn: 1, internal: [entry('src/a.ts', 'committed')] })]
    const html = renderToStaticMarkup(
      <RecordsTab records={records} t={t} onOpenDiff={() => {}} execute={async () => true} />,
    )
    expect(html).not.toContain(t('work.stage.ai'))
    expect(html).not.toContain(t('work.stage.all'))
  })
})
