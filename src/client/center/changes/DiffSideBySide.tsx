/**
 * 差异对照查看器（IDEA 式）——按视图模式分发：
 *   - split（默认）：左右对照（PairDiffView），左=变更前 / 右=变更后，
 *     双列间可拖拽调整占比（20%–80%），行号 + 状态着色；
 *   - before / after：单侧内容流全宽渲染（StreamDiffView）——过滤对侧
 *     独有变更后的完整「变更前 / 变更后」内容，无空档。
 *
 * 共同增强：超大差异仅渲染前 MAX_DIFF_ROWS 行（防万行级 diff 卡死）；
 * 按设置折叠长冗余上下文（foldContext / foldStream，标记按可见流坐标
 * 绝对定位）；按文件类型语法高亮（整块 tokenize 后按行索引用——跨行
 * token 正确）；字号可配置；窗口化渲染（DOM 与总行数解耦）。
 *
 * 纯新增 / 纯删除差异不进入本组件（由 ChangesTab 分流到 SingleFileView）。
 */
import { memo, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import {
  buildSideBySide, buildStream, capSideBySideRows, foldContext, foldMarkerLines, foldStream, streamMarkerLines,
  isBinaryDiff, type SideBySideRow, type SideCell, type StreamLine,
} from '../../side-by-side.ts'
import { highlightLines, type HighlightSpan } from '../../syntax/highlighter.ts'
import { useHighlightReady } from '../../syntax/use-highlight-ready.ts'
import { langOfPath } from '../../syntax/lang-map.ts'
import { useWindowSlice } from '../../use-window-slice.ts'
import { DIFF_FOLD_THRESHOLD, type DiffSettings } from '../../../contracts/settings.ts'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'
import { Splitter } from '../Splitter.tsx'
import { clampDiffRatio } from '../shared.ts'

/** 差异行固定高度（px）：与 sbsContainer.lineHeight 一致——折叠标记按
 * 「已渲染行数 × 行高」绝对定位，展开/收起不产生布局抖动。 */
const FOLD_ROW_H = 18

/** 超大差异渲染截断（防万行级 diff 卡死渲染；两子视图共用）。 */
const MAX_DIFF_ROWS = 2000

/** 窗口化 overscan：可视窗上下额外渲染的行数（防快速滚动露出空白）。 */
const DIFF_OVERSCAN = 10

/** 差异视图模式：对照（默认）/ 仅变更前 / 仅变更后。 */
export type DiffViewMode = 'split' | 'before' | 'after'

/** 行 → 高亮 token 行索引对齐条目（跳过 empty 位；与整块 tokenize 的行序一致）。 */
interface IndexedEntry {
  readonly row: SideBySideRow
  readonly left: { readonly cell: SideCell; readonly ti: number } | null
  readonly right: { readonly cell: SideCell; readonly ti: number } | null
}

/** 单元格背景色：删除红 / 新增绿 / 空位灰 / 上下文无（模块级纯函数）。 */
const sbsCellColor = (kind: SideCell['kind']): CSSProperties =>
  kind === 'del' ? css.sbsDel : kind === 'add' ? css.sbsAdd : kind === 'empty' ? css.sbsEmpty : {}

/** 单流行背景色：删除红 / 新增绿 / 上下文无。 */
const streamLineColor = (kind: StreamLine['kind']): CSSProperties =>
  kind === 'del' ? css.sbsDel : kind === 'add' ? css.sbsAdd : {}

/** 代码段渲染：纯文本或高亮 span 序列（模块级纯函数）。 */
const renderCode = (text: string, tokens: readonly HighlightSpan[] | undefined): JSX.Element => (
  <>
    {tokens === undefined || tokens.length === 0 ? text : tokens.map((span, i) => (
      <span key={i} style={span.style}>{span.text}</span>
    ))}
  </>
)

/**
 * 差异单元格（memo 化）：窗口化后仅可见 cell 入树，props 稳定（entry/tokenRows
 * 引用随 useMemo 稳定）时跳过 reconciliation——窗口化 + memo 双重削减压。
 */
const DiffCell = memo(function DiffCell({
  entry, side, tokens,
}: {
  entry: IndexedEntry
  side: 'left' | 'right'
  tokens: readonly HighlightSpan[] | undefined
}): JSX.Element {
  const meta = side === 'left' ? entry.left : entry.right
  if (meta === null) {
    return (
      <div style={{ ...css.sbsCell, ...css.sbsEmpty }}>
        <span style={css.sbsNum} />
        <span style={css.sbsCode} />
      </div>
    )
  }
  const { cell } = meta
  return (
    <div style={{ ...css.sbsCell, ...sbsCellColor(cell.kind) }}>
      <span style={css.sbsNum}>{cell.num ?? ''}</span>
      <span style={css.sbsCode}>{renderCode(cell.text, tokens)}</span>
    </div>
  )
})

/** 截断提示行（超过 MAX_DIFF_ROWS 时由两个子视图共用）。 */
function TruncatedNote({ count, t }: { readonly count: number; readonly t: (key: GitKey) => string }): JSX.Element {
  return <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(count))}</div>
}

/** 折叠标记覆盖按钮（pair / stream 共用样式与行为）。 */
function FoldMarker({
  top, count, t, onToggle,
}: {
  readonly top: number
  readonly count: number
  readonly t: (key: GitKey) => string
  readonly onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="dsh-git-ui__fold-overlay"
      style={{ ...css.diffFoldOverlay, top }}
      onClick={onToggle}
    >
      {t('diff.foldCollapsed').replace('{n}', String(count))}
    </button>
  )
}

/**
 * 左右对照子视图（split 模式）：双列共享纵向滚动、各列独立横向滚动；
 * 双列间 Splitter 可拖拽调整左列占比（leftRatio ∈ [0.2, 0.8]）。
 */
function PairDiffView({
  capped, totalRows, path, diff, t, leftRatio, onRatioChange,
}: {
  readonly capped: readonly SideBySideRow[]
  readonly totalRows: number
  readonly path: string
  readonly diff: DiffSettings
  readonly t: (key: GitKey) => string
  /** 左列占比（0–1，已钳制）。 */
  readonly leftRatio: number
  /** 拖拽请求新占比（0–1；子视图内部不钳制，由父级 clampDiffRatio 兜底）。 */
  readonly onRatioChange: (next: number) => void
}): JSX.Element {
  const highlightReady = useHighlightReady()
  // 折叠块（默认开）：>DIFF_FOLD_THRESHOLD 的连续上下文段折叠为「… N 行」。
  const blocks = useMemo(() => (
    diff.foldContext ? foldContext(capped, DIFF_FOLD_THRESHOLD) : undefined
  ), [capped, diff.foldContext])
  /** 已展开的 fold 块索引（点击标记展开；再次点击收起）。 */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())

  // 行 → 高亮 token 行索引对齐（跳过 empty 位；与整块 tokenize 的行序一致）。
  const allIndexed = useMemo(() => {
    let li = 0
    let ri = 0
    return capped.map((row) => ({
      row,
      left: row.left.kind === 'empty' ? null : { cell: row.left, ti: li++ },
      right: row.right.kind === 'empty' ? null : { cell: row.right, ti: ri++ },
    }))
  }, [capped])

  /** 实际渲染行（折叠行跳过）；ti 在折叠时仍推进，故行号与 token 索引恒对齐。 */
  const rendered = useMemo(() => {
    if (blocks === undefined) return allIndexed
    const out: typeof allIndexed = []
    let cursor = 0
    blocks.forEach((block, index) => {
      const count = block.kind === 'fold' ? block.rows.length : 1
      if (block.kind === 'fold' && !expanded.has(index)) {
        cursor += count
        return
      }
      for (let i = 0; i < count; i += 1) {
        const entry = allIndexed[cursor + i]
        if (entry !== undefined) out.push(entry)
      }
      cursor += count
    })
    return out
  }, [blocks, allIndexed, expanded])

  // 整块高亮（每列一份；跨行注释/字符串保持正确）。构造完成前为纯文本。
  const lang = useMemo(() => langOfPath(path), [path])
  const highlightOn = diff.syntaxHighlight && highlightReady > 0 && lang !== undefined
  const leftTokens = useMemo(
    () => (highlightOn ? highlightLines(capped.filter((r) => r.left.kind !== 'empty').map((r) => r.left.text).join('\n'), lang!) : undefined),
    [capped, highlightOn, lang],
  )
  const rightTokens = useMemo(
    () => (highlightOn ? highlightLines(capped.filter((r) => r.right.kind !== 'empty').map((r) => r.right.text).join('\n'), lang!) : undefined),
    [capped, highlightOn, lang],
  )

  /** 未展开的折叠标记元数据：line = 可见流中的逻辑插入点（渲染层乘行高定位）。 */
  const foldBlocks = useMemo(() => {
    if (blocks === undefined) return []
    return foldMarkerLines(blocks, expanded).map(({ index, line, count }) => ({
      index,
      top: line * FOLD_ROW_H,
      count,
    }))
  }, [blocks, expanded])

  // 展开态随内容变化重置：expanded 存放 fold 块序号，文件切换（blocks 内容
  // 变化）后旧序号会「按编号误用」新 diff 的块——重置防止跨文件泄漏。
  useEffect(() => {
    setExpanded(new Set())
  }, [blocks])

  /** 展开 / 收起一个折叠块（expanded 按 fold 块在 blocks 中的序号管理）。 */
  const toggleFold = (index: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  /** 窗口化：只渲染可视窗 ±overscan 行（顶垫/底垫撑出真实滚动高度，DOM 与行数解耦）。 */
  const { ref: scrollRef, slice, onScroll } = useWindowSlice(rendered.length, FOLD_ROW_H, DIFF_OVERSCAN)

  /** 占比拖拽：像素位移 → 容器宽占比（容器宽取自滚动容器 clientWidth）。 */
  const onSplitterDrag = (dx: number): void => {
    const w = scrollRef.current?.clientWidth ?? 0
    if (w <= 0) return
    onRatioChange(clampDiffRatio(leftRatio + dx / w))
  }

  /** 折叠标记（覆盖层）：absolute 横跨双列，top 按全局可见流坐标 × 行高定位。
   *  窗口化后顶垫+底垫保持了「全局坐标×行高」的物理位置映射，故 top 无需平移；
   *  仅渲染落入当前窗口的标记，避免视口外标记堆叠。 */
  const foldMarkers: readonly JSX.Element[] = foldBlocks
    .filter(({ top }) => {
      const line = top / FOLD_ROW_H
      return line >= slice.start && line < slice.end
    })
    .map(({ index, top, count }) => (
      <FoldMarker key={index} top={top} count={count} t={t} onToggle={() => toggleFold(index)} />
    ))

  // 每列只渲染窗口切片（顶垫撑出窗口前高度 + 可见 cell + 底垫撑出剩余高度）；
  // 双列共享同一切片，左右行一一对应。tokens 按 ti 预取传入 memo cell。
  const renderColumn = (side: 'left' | 'right'): readonly JSX.Element[] => {
    const tokenRows = side === 'left' ? leftTokens : rightTokens
    return rendered.slice(slice.start, slice.end).map((entry, i) => {
      const meta = side === 'left' ? entry.left : entry.right
      const tokens = meta === null ? undefined : tokenRows?.[meta.ti]
      return <DiffCell key={slice.start + i} entry={entry} side={side} tokens={tokens} />
    })
  }
  const topPad = slice.start * FOLD_ROW_H
  const bottomPad = Math.max(0, rendered.length - slice.end) * FOLD_ROW_H
  const padStyle: CSSProperties = { height: topPad, width: '100%', flexShrink: 0 }
  const bottomPadStyle: CSSProperties = { height: bottomPad, width: '100%', flexShrink: 0 }
  const leftPct = Math.round(clampDiffRatio(leftRatio) * 100)

  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} data-diff-mode="split" style={{ ...css.sbsContainer, position: 'relative', fontSize: diff.fontSize }}>
        <div style={{ ...css.sbsCol, flex: `0 0 ${leftPct}%` }}>
          <div style={css.sbsColInner}>
            <div style={padStyle} aria-hidden="true" />
            {renderColumn('left')}
            <div style={bottomPadStyle} aria-hidden="true" />
          </div>
        </div>
        <Splitter kind="col" onDrag={onSplitterDrag} />
        <div style={css.sbsCol}>
          <div style={css.sbsColInner}>
            <div style={padStyle} aria-hidden="true" />
            {renderColumn('right')}
            <div style={bottomPadStyle} aria-hidden="true" />
          </div>
        </div>
        {foldMarkers}
      </div>
      {totalRows > capped.length && <TruncatedNote count={capped.length} t={t} />}
    </>
  )
}

/**
 * 单侧内容流子视图（before / after 模式）：全宽单栏渲染过滤后的单侧
 * 内容——before = 上下文 + 删除行（变更前全文），after = 上下文 + 新增行
 * （变更后全文）。对侧独有行剔除，无空档；折叠坐标在过滤后的流上独立计算。
 */
function StreamDiffView({
  capped, totalRows, path, diff, t, side, mode,
}: {
  readonly capped: readonly SideBySideRow[]
  readonly totalRows: number
  readonly path: string
  readonly diff: DiffSettings
  readonly t: (key: GitKey) => string
  readonly side: 'left' | 'right'
  readonly mode: 'before' | 'after'
}): JSX.Element {
  const highlightReady = useHighlightReady()
  const lines = useMemo(() => buildStream(capped, side), [capped, side])
  const blocks = useMemo(() => (
    diff.foldContext ? foldStream(lines, DIFF_FOLD_THRESHOLD) : undefined
  ), [lines, diff.foldContext])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())

  /** 实际渲染行（折叠段跳过，段内行序即 token 索引序）。 */
  const rendered = useMemo(() => {
    if (blocks === undefined) return lines
    const out: StreamLine[] = []
    let cursor = 0
    blocks.forEach((block, index) => {
      const count = block.kind === 'fold' ? block.lines.length : 1
      if (block.kind === 'fold' && !expanded.has(index)) {
        cursor += count
        return
      }
      for (let i = 0; i < count; i += 1) {
        const line = lines[cursor + i]
        if (line !== undefined) out.push(line)
      }
      cursor += count
    })
    return out
  }, [blocks, lines, expanded])

  // 整块高亮（单系列；跨行注释/字符串保持正确）。构造完成前为纯文本。
  const lang = useMemo(() => langOfPath(path), [path])
  const highlightOn = diff.syntaxHighlight && highlightReady > 0 && lang !== undefined
  const tokens = useMemo(
    () => (highlightOn ? highlightLines(lines.map((l) => l.text).join('\n'), lang!) : undefined),
    [lines, highlightOn, lang],
  )

  const foldBlocks = useMemo(() => {
    if (blocks === undefined) return []
    return streamMarkerLines(blocks, expanded).map(({ index, line, count }) => ({
      index,
      top: line * FOLD_ROW_H,
      count,
    }))
  }, [blocks, expanded])

  // 展开态随内容/侧变化重置（跨文件或切侧后旧序号按编号误用新块）。
  useEffect(() => {
    setExpanded(new Set())
  }, [blocks])

  const toggleFold = (index: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const { ref: scrollRef, slice, onScroll } = useWindowSlice(rendered.length, FOLD_ROW_H, DIFF_OVERSCAN)

  const foldMarkers: readonly JSX.Element[] = foldBlocks
    .filter(({ top }) => {
      const line = top / FOLD_ROW_H
      return line >= slice.start && line < slice.end
    })
    .map(({ index, top, count }) => (
      <FoldMarker key={index} top={top} count={count} t={t} onToggle={() => toggleFold(index)} />
    ))

  const renderLines = rendered.slice(slice.start, slice.end).map((line, i) => {
    const tokensOfLine = tokens?.[slice.start + i]
    return (
      <div key={slice.start + i} style={{ ...css.sbsCell, ...streamLineColor(line.kind) }}>
        <span style={css.sbsNum}>{line.num ?? ''}</span>
        <span style={css.sbsCode}>{renderCode(line.text, tokensOfLine)}</span>
      </div>
    )
  })
  const topPad = slice.start * FOLD_ROW_H
  const bottomPad = Math.max(0, rendered.length - slice.end) * FOLD_ROW_H
  const padStyle: CSSProperties = { height: topPad, width: '100%', flexShrink: 0 }
  const bottomPadStyle: CSSProperties = { height: bottomPad, width: '100%', flexShrink: 0 }

  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} data-diff-mode={mode} style={{ ...css.sbsContainer, position: 'relative', fontSize: diff.fontSize }}>
        <div style={css.sbsCol}>
          <div style={css.sbsColInner}>
            <div style={padStyle} aria-hidden="true" />
            {renderLines}
            <div style={bottomPadStyle} aria-hidden="true" />
          </div>
        </div>
        {foldMarkers}
      </div>
      {totalRows > capped.length && <TruncatedNote count={capped.length} t={t} />}
    </>
  )
}

/** 差异对照查看器入口：解析 + 守卫（二进制 / 无差异）后按模式分发子视图。 */
export function DiffSideBySide({
  text, path, diff, t, mode = 'split', leftRatio = 0.5, onRatioChange = () => {},
}: {
  text: string
  path: string
  diff: DiffSettings
  t: (key: GitKey) => string
  /** 视图模式：split（默认等分对照）/ before（仅变更前）/ after（仅变更后）。 */
  mode?: DiffViewMode
  /** split 模式左列占比（0–1，钳制区间 [DIFF_RATIO_MIN, DIFF_RATIO_MAX]）。 */
  leftRatio?: number
  /** split 模式拖拽占比回调（收到未钳制值，父级按需钳制后落状态）。 */
  onRatioChange?: (next: number) => void
}): JSX.Element {
  const rows = useMemo(() => buildSideBySide(text), [text])
  const capped = useMemo(() => capSideBySideRows(rows, MAX_DIFF_ROWS), [rows])

  if (isBinaryDiff(text)) return <div style={css.emptyNote}>{t('diff.binary')}</div>
  if (rows.length === 0) return <div style={css.emptyNote}>{t('center.diffEmpty')}</div>

  if (mode === 'before' || mode === 'after') {
    return (
      <StreamDiffView
        capped={capped}
        totalRows={rows.length}
        path={path}
        diff={diff}
        t={t}
        side={mode === 'before' ? 'left' : 'right'}
        mode={mode}
      />
    )
  }
  return (
    <PairDiffView
      capped={capped}
      totalRows={rows.length}
      path={path}
      diff={diff}
      t={t}
      leftRatio={leftRatio}
      onRatioChange={onRatioChange}
    />
  )
}
