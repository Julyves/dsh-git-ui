/**
 * 新增文件视图：纯新增差异（无历史侧内容）的「直接展示」形态。
 *
 * 用户诉求：新增不是修改——不需要并排对照、不需要左侧空白。本组件
 * 单栏全宽渲染创建后的完整文件内容：行号 + 整块语法高亮（跨行 token
 * 正确），无增删着色（内容自身即为「新增」，不重复强调）。
 *
 * `content` 为纯文件内容文本（由 side-by-side.extractAddedContent
 * 从 unified diff 提取），`path` 仅用于语言推断。
 */
import { useMemo } from 'react'
import type { JSX, CSSProperties } from 'react'
import { highlightLines } from './syntax/highlighter.ts'
import { useHighlightReady } from './syntax/use-highlight-ready.ts'
import { langOfPath } from './syntax/lang-map.ts'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** 新增文件内容行数上限（与并排差异视图的 MAX_DIFF_ROWS 同量级：
 * 万行级新文件全量 DOM + 整文件 tokenize 会卡死渲染，截断兜底）。 */
const MAX_NEW_FILE_ROWS = 2000

export function NewFileView({
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
  const capped = useMemo(() => lines.slice(0, MAX_NEW_FILE_ROWS), [lines])
  const lang = useMemo(() => langOfPath(path), [path])
  const tokens = useMemo(
    () => (highlight && ready > 0 && lang !== undefined ? highlightLines(capped.join('\n'), lang) : undefined),
    [capped, lang, highlight, ready],
  )
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

  return (
    <div style={{ ...css.newFileContainer, ...containerStyle }}>
      <div style={css.newFileColInner}>
        {content === ''
          ? <div style={css.emptyNote}>{t('diff.newFileEmpty')}</div>
          : capped.map(renderLine)}
      </div>
      {lines.length > MAX_NEW_FILE_ROWS && (
        <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(MAX_NEW_FILE_ROWS))}</div>
      )}
    </div>
  )
}
