/**
 * 单栏文件视图：单侧内容的「直接展示」形态（新增文件 / 被删文件共用）。
 *
 * 用户诉求：新增与删除都不是修改——不需要并排对照、不需要空白对侧。
 * 本组件单栏全宽渲染一侧的完整文件内容：行号 + 整块语法高亮（跨行
 * token 正确），无增删着色（内容自身即为该侧事实，不重复强调）。
 *
 * `content` 为纯文件内容文本（新增 = side-by-side.extractAddedContent、
 * 删除 = extractDeletedContent 从 unified diff 提取），`path` 仅用于语言
 * 推断。
 *
 * 性能：窗口化渲染——只渲染可视窗 ±overscan 行，上下以占位 div 撑出真实
 * 滚动高度，DOM 规模与文件行数解耦（与并排差异视图同构，几千行也流畅）。
 */
import { useMemo } from 'react'
import type { JSX, CSSProperties } from 'react'
import { highlightLines } from './syntax/highlighter.ts'
import { useHighlightReady } from './syntax/use-highlight-ready.ts'
import { langOfPath } from './syntax/lang-map.ts'
import { useWindowSlice } from './use-window-slice.ts'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** 单栏内容行数上限（与并排差异视图的 MAX_DIFF_ROWS 同量级：
 * 万行级文件全量 DOM + 整文件 tokenize 会卡死渲染，截断兜底）。 */
const MAX_SINGLE_FILE_ROWS = 2000

/** 行高（px）：与 newFileContainer.lineHeight 一致——窗口化顶垫/底垫按此撑高。 */
const SINGLE_FILE_ROW_H = 18

/** 窗口化 overscan：可视窗上下额外渲染的行数（防快速滚动露出空白）。 */
const SINGLE_FILE_OVERSCAN = 10

export function SingleFileView({
  content, path, fontSize, highlight, t,
}: {
  readonly content: string
  readonly path: string
  /** 代码文字大小（px，来自设置）。 */
  readonly fontSize: number
  /** 语法高亮开关（设置）。 */
  readonly highlight: boolean
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const ready = useHighlightReady()
  const lines = useMemo(() => content.split('\n'), [content])
  const capped = useMemo(() => lines.slice(0, MAX_SINGLE_FILE_ROWS), [lines])
  const lang = useMemo(() => langOfPath(path), [path])
  const tokens = useMemo(
    () => (highlight && ready > 0 && lang !== undefined ? highlightLines(capped.join('\n'), lang) : undefined),
    [capped, lang, highlight, ready],
  )
  const { ref, slice, onScroll } = useWindowSlice(capped.length, SINGLE_FILE_ROW_H, SINGLE_FILE_OVERSCAN)
  const containerStyle: CSSProperties = { ...css.newFileContainer, fontSize }

  const renderLine = (line: string, index: number): JSX.Element => {
    const spans = tokens?.[index]
    return (
      <div key={index} style={css.newFileCell}>
        <span style={css.newFileNum}>{index + 1}</span>
        <span style={css.newFileCode}>
          {spans === undefined || spans.length === 0 ? line : spans.map((span, si) => (
            <span key={si} style={span.style}>{span.text}</span>
          ))}
        </span>
      </div>
    )
  }

  const topPad = slice.start * SINGLE_FILE_ROW_H
  const bottomPad = Math.max(0, capped.length - slice.end) * SINGLE_FILE_ROW_H
  const padStyle: CSSProperties = { height: topPad, width: '100%', flexShrink: 0 }
  const bottomPadStyle: CSSProperties = { height: bottomPad, width: '100%', flexShrink: 0 }

  return (
    <div ref={ref} onScroll={onScroll} style={{ ...css.newFileContainer, ...containerStyle }}>
      <div style={css.newFileColInner}>
        {content === ''
          ? <div style={css.emptyNote}>{t('diff.newFileEmpty')}</div>
          : (
            <>
              <div style={padStyle} aria-hidden="true" />
              {capped.slice(slice.start, slice.end).map((line, i) => renderLine(line, slice.start + i))}
              <div style={bottomPadStyle} aria-hidden="true" />
            </>
          )}
      </div>
      {lines.length > MAX_SINGLE_FILE_ROWS && (
        <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(MAX_SINGLE_FILE_ROWS))}</div>
      )}
    </div>
  )
}
