/**
 * 轻量 Markdown 渲染器（零依赖，变更页「渲染」视图专用）。
 *
 * 设计约束：
 *   - **安全第一**：全部内容经 React 文本节点构造（无 dangerouslySetInnerHTML），
 *     源文本中的原始 HTML 天然转义；链接 scheme 白名单（http/https/mailto/相对），
 *     javascript: 等危险 scheme 降级为纯文本。
 *   - **零依赖**：块级逐行状态机 + 行内扫描，覆盖日常文档结构（标题/段落/
 *     粗斜删除/行内码/链接/图片/引用/有序无序嵌套列表/围栏代码/GFM 表格/hr）。
 *     不追求 CommonMark 完整性——预览场景够用，未知结构按段落兜底。
 *   - **主题化**：排版样式全部走 styles/markdown.ts 的 token 化常量。
 *   - 围栏代码高亮复用 syntax/highlighter（语言名经 langOfPath('x.'+lang)
 *     巧妙映射——'ts'→typescript、'py'→python、'sh'→shellscript 均命中
 *     EXTENSION_LANG 表；未注册语言自然 undefined 回落纯文本）。
 */
import { useMemo, useState, useId, type JSX, type ReactNode } from 'react'
import { buildSideBySide, buildStream } from './side-by-side.ts'
import { highlightLines } from './syntax/highlighter.ts'
import { useHighlightReady } from './syntax/use-highlight-ready.ts'
import { langOfPath } from './syntax/lang-map.ts'
import { DiagramSvg, parseMermaid } from './mermaid-lite.tsx'
import type { GitKey } from './locales.ts'
import * as css from './styles.ts'

/** 渲染源行数上限：超大文档全量解析 DOM 会卡死渲染，截断兜底
 *（与并排差异视图 MAX_DIFF_ROWS 同量级）。 */
const MAX_MARKDOWN_ROWS = 2000

/** 链接 scheme 白名单外的降级：渲染为纯文本（不可点）。 */
function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return null
  // 带 scheme 的仅放行白名单（http/https/mailto）；无 scheme 的（相对路径/
  // 锚点/协议相对）一律放行——相对路径不以 / . # 开头的形态（docs/x.png）
  // 是 README 图片的常态，不能误拒。
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1]!.toLowerCase()
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? trimmed : null
  }
  return trimmed
}

// ── 行内解析：扫描 **粗** *斜* ~~删~~ `码` [文](url) ![图](url) ─────────────

/** 行内节点扫描：返回文本/强调节点序列（顺序敏感，先长标记后短标记）。 */
function parseInline(text: string, keyPrefix: string): readonly ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let i = 0
  let key = 0
  const push = (node: ReactNode): void => {
    if (buf !== '') { out.push(buf); buf = '' }
    out.push(node)
  }
  const nextKey = (): string => `${keyPrefix}-${key++}`

  while (i < text.length) {
    const rest = text.slice(i)
    // 原始 HTML img（白名单标签）：README 等文档常直接书写 <img src=… width=…>。
    // 只提取 src/alt/width 三个属性，src 仍走 safeUrl 白名单，其余属性丢弃。
    if (rest.startsWith('<')) {
      const m = /^<img\s[^>]*>/i.exec(rest)
      if (m !== null) {
        const tag = m[0]
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
        const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
        const width = /\bwidth\s*=\s*["']?(\d+)["']?/i.exec(tag)?.[1]
        if (src === undefined) {
          buf += tag
        } else {
          const url = safeUrl(src)
          push(url === null
            ? alt
            : <img key={nextKey()} src={url} alt={alt} loading="lazy"
                style={{ ...css.mdImage, ...(width !== undefined ? { width: Number(width) } : {}) }} />)
        }
        i += tag.length
        continue
      }
    }
    // 行内代码：`...`（最短匹配——内容不再解析强调，避免嵌套歧义）。
    if (rest.startsWith('`')) {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        push(<code key={nextKey()} style={css.mdInlineCode}>{text.slice(i + 1, end)}</code>)
        i = end + 1
        continue
      }
    }
    // 图片：![alt](url)
    if (rest.startsWith('![')) {
      const m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
      if (m !== null) {
        const url = safeUrl(m[2]!)
        push(url === null
          ? m[1]!
          : <img key={nextKey()} src={url} alt={m[1]!} style={css.mdImage} loading="lazy" />)
        i += m[0].length
        continue
      }
    }
    // 链接：[text](url)——文字部分递归解析强调。
    if (rest.startsWith('[')) {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
      if (m !== null) {
        const url = safeUrl(m[2]!)
        const label = parseInline(m[1]!, nextKey())
        push(url === null
          ? <span key={nextKey()}>{label}</span>
          : <a key={nextKey()} href={url} target="_blank" rel="noreferrer noopener" style={css.mdLink}>{label}</a>)
        i += m[0].length
        continue
      }
    }
    // 删除 / 粗体 / 斜体（长标记优先：** 在 * 之前判定）。
    if (rest.startsWith('~~')) {
      const end = text.indexOf('~~', i + 2)
      if (end > i) {
        push(<s key={nextKey()} style={css.mdStrike}>{parseInline(text.slice(i + 2, end), nextKey())}</s>)
        i = end + 2
        continue
      }
    }
    if (rest.startsWith('**')) {
      const end = text.indexOf('**', i + 2)
      if (end > i) {
        push(<strong key={nextKey()} style={css.mdStrong}>{parseInline(text.slice(i + 2, end), nextKey())}</strong>)
        i = end + 2
        continue
      }
    }
    if (rest.startsWith('*') || rest.startsWith('_')) {
      const marker = rest[0]!
      const end = text.indexOf(marker, i + 1)
      if (end > i) {
        push(<em key={nextKey()} style={css.mdEm}>{parseInline(text.slice(i + 1, end), nextKey())}</em>)
        i = end + 1
        continue
      }
    }
    buf += text[i]
    i += 1
  }
  if (buf !== '') out.push(buf)
  return out
}

// ── 块级解析：逐行状态机 → 块节点 ──────────────────────────────────────────

/** 一个待渲染块（解析的中间表示）。 */
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: readonly string[] }
  | { kind: 'code'; lang: string; lines: readonly string[] }
  | { kind: 'quote'; lines: readonly string[] }
  | { kind: 'hr' }
  | { kind: 'list'; ordered: boolean; items: readonly ListItem[] }
  | { kind: 'table'; header: readonly string[]; rows: readonly (readonly string[])[] }

interface ListItem {
  readonly text: string
  readonly children: readonly Block[]
}

/** 无序列表项前缀（- / * / + 后跟空格）。 */
const UL_RE = /^([-*+]) +(.*)$/
/** 有序列表项前缀（1. / 23) 后跟空格）。 */
const OL_RE = /^(\d+)[.)] +(.*)$/
/** 表格分隔行（| --- | :---: |）。 */
const TABLE_SEP_RE = /^\|? *:?-{2,}:? *(?:\| *:?-{2,}:? *)*\|?$/
/** 标题行（#~###### 后跟空格或行尾）。 */
const HEADING_RE = /^(#{1,6}) +(.*)$/
/** hr 行（--- / *** / ___，三字符以上）。 */
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/

/** 解析块序列（纯函数；lines 为去除了过长的截断后源行）。 */
function parseBlocks(lines: readonly string[]): readonly Block[] {
  const blocks: Block[] = []
  let i = 0

  /** 解析一个列表（含嵌套）：start 为已匹配的首项行号。返回消耗的行数。 */
  const parseList = (start: number, ordered: boolean): number => {
    const flat: Array<{ depth: number; text: string }> = []
    let j = start
    while (j < lines.length) {
      const line = lines[j]!
      if (line.trim() === '') break
      const indentMatch = /^( *)/.exec(line)
      const indentLen = indentMatch?.[1]?.length ?? 0
      const depth = Math.floor(indentLen / 2)
      const rest = line.slice(indentLen)
      const ul = UL_RE.exec(rest)
      const ol = OL_RE.exec(rest)
      if (ul !== null && !ordered) flat.push({ depth, text: ul[2]! })
      else if (ol !== null && ordered) flat.push({ depth, text: ol[2]! })
      else if (flat.length > 0 && /^( +\S|\S)/.test(line) && line.trim() !== '') {
        // 懒延续：非空行且非新列表项 → 并入上一项文本。
        const prev = flat[flat.length - 1]!
        prev.text = `${prev.text} ${line.trim()}`
      } else break
      j += 1
    }
    /** 按深度递归组装（flat → 树）：每个项吃掉紧随其后的「更深连续段」
     *  作子列表，同级兄弟段各自归属——避免把兄弟子列表误并为一家。 */
    const build = (items: ReadonlyArray<{ depth: number; text: string }>, depth: number): readonly ListItem[] => {
      const out: ListItem[] = []
      let k = 0
      while (k < items.length) {
        const item = items[k]!
        if (item.depth < depth) break
        if (item.depth === depth) {
          // 本项的子级 = 紧随其后的更深连续段（截至回到 ≤depth）。
          let end = k + 1
          while (end < items.length && items[end]!.depth > depth) end += 1
          const childItems = items.slice(k + 1, end)
          const children: readonly Block[] = childItems.length > 0
            ? [{ kind: 'list', ordered: false, items: build(childItems, childItems[0]!.depth) }]
            : []
          out.push({ text: item.text, children })
          k = end
        } else {
          // 缩进跳级（无父项承接）：按当前层收纳，不丢内容。
          out.push({ text: item.text, children: [] })
          k += 1
        }
      }
      return out
    }
    blocks.push({ kind: 'list', ordered, items: build(flat, flat[0]?.depth ?? 0) })
    return j - start
  }

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') { i += 1; continue }

    // 围栏代码：``` / ~~~（info 字符串取首个 token 作语言名）。
    const fence = /^ {0,3}(```|~~~)\s*(.*)$/.exec(line)
    if (fence !== null) {
      const marker = fence[1]!
      const lang = fence[2]!.trim().split(/\s+/)[0] ?? ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) {
        body.push(lines[i]!)
        i += 1
      }
      i += 1 // 跳过闭合围栏（或越界结尾——未闭合按文档尾处理）。
      blocks.push({ kind: 'code', lang, lines: body })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() })
      i += 1
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }

    // 引用块：> 前缀行连续收集（内部按原文递归解析块）。
    if (/^ {0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^ {0,3}>/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^ {0,3}> ?/, ''))
        i += 1
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }

    // 列表：按首行前缀类型分流。
    if (UL_RE.test(line.replace(/^ */, ''))) {
      i += parseList(i, false)
      continue
    }
    if (OL_RE.test(line.replace(/^ */, ''))) {
      i += parseList(i, true)
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行。
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!.trim())) {
      const splitRow = (row: string): readonly string[] =>
        row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push([...splitRow(lines[i]!)])
        i += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // 段落：连续非空行合并（遇块级结构停）。
    const para: string[] = []
    while (
      i < lines.length && lines[i]!.trim() !== ''
      && !HEADING_RE.test(lines[i]!) && !HR_RE.test(lines[i]!)
      && !/^ {0,3}(```|~~~|>)/.test(lines[i]!)
      && !UL_RE.test(lines[i]!.replace(/^ */, '')) && !OL_RE.test(lines[i]!.replace(/^ */, ''))
    ) {
      para.push(lines[i]!.trim())
      i += 1
    }
    if (para.length > 0) blocks.push({ kind: 'paragraph', lines: para })
    else i += 1 // 兜底前进（防御死循环）。
  }
  return blocks
}

/** 列表标记（ul 圆点 / ol 序号）。 */
function listMarker(ordered: boolean, index: number): string {
  return ordered ? `${index + 1}.` : '•'
}

/**
 * Mermaid 围栏块：左上角「渲染 / 源码」切换；渲染失败在块区域中心提示
 * （附解析原因），可切源码查看原文。源码态为纯文本（mermaid grammar
 * 不在 shiki 预算子集内，与未注册语言的回落一致）。
 */
function MermaidBlock({ source, t }: {
  readonly source: string
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const parse = useMemo(() => parseMermaid(source), [source])
  // useId 含非 url 安全字符（如 «:r0:»），marker 引用需净化。
  const markerId = `dmd-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const options: Array<{ id: 'rendered' | 'source'; label: string }> = [
    { id: 'rendered', label: t('diff.view.rendered') },
    { id: 'source', label: t('diff.mermaid.source') },
  ]
  return (
    <div style={css.mdMermaidWrap}>
      <div style={css.mdMermaidToggle} role="group" aria-label={t('diff.view')}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="dsh-git-ui__segment"
            style={mode === option.id ? { ...css.mdMermaidToggleBtn, ...css.mdMermaidToggleBtnOn } : css.mdMermaidToggleBtn}
            aria-pressed={mode === option.id}
            onClick={() => setMode(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === 'rendered'
        ? (parse.ok
          ? <DiagramSvg diagram={parse.diagram} markerId={markerId} />
          : (
            <div style={css.mdMermaidError}>
              <span>{t('diff.mermaid.error')}</span>
              <span style={css.mdMermaidErrorReason}>{parse.reason}</span>
            </div>
          ))
        : (
          <pre style={css.mdPre}>
            <code style={css.mdCode}>{source}</code>
          </pre>
        )}
    </div>
  )
}

/** Markdown 渲染视图：source 为纯文本源（当前侧完整内容）。 */
export function MarkdownView({
  source, fontSize, highlight, t,
}: {
  readonly source: string
  /** 正文字号（px，与差异视图设置联动）。 */
  readonly fontSize: number
  /** 围栏代码高亮开关（设置）。 */
  readonly highlight: boolean
  readonly t: (key: GitKey) => string
}): JSX.Element {
  const ready = useHighlightReady()
  const lines = useMemo(() => source.split('\n'), [source])
  const truncated = lines.length > MAX_MARKDOWN_ROWS
  const capped = useMemo(() => (truncated ? lines.slice(0, MAX_MARKDOWN_ROWS) : lines), [lines, truncated])
  const blocks = useMemo(() => parseBlocks(capped), [capped])

  /** 围栏代码块渲染：语言名 → grammar id（经扩展名表映射），高亮整块。 */
  const renderCode = (lang: string, codeLines: readonly string[], key: string): JSX.Element => {
    const text = codeLines.join('\n')
    // mermaid 块：走图渲染器（含渲染/源码切换与失败提示）。
    if (lang === 'mermaid') return <MermaidBlock key={key} source={text} t={t} />
    const langId = lang === '' ? undefined : langOfPath(`x.${lang}`)
    const tokens = highlight && ready > 0 && langId !== undefined
      ? highlightLines(text, langId)
      : undefined
    return (
      <pre key={key} style={css.mdPre}>
        <code style={css.mdCode}>
          {codeLines.map((line, li) => (
            <div key={li} style={css.mdCodeLine}>
              {tokens?.[li] === undefined || tokens[li]!.length === 0
                ? line
                : tokens[li]!.map((span, si) => <span key={si} style={span.style}>{span.text}</span>)}
            </div>
          ))}
        </code>
      </pre>
    )
  }

  /** 块渲染分发。 */
  const renderBlock = (block: Block, key: string): JSX.Element => {
    switch (block.kind) {
      case 'heading': {
        const style = css.mdHeadings[block.level] ?? css.mdH4
        return <div key={key} style={style}>{parseInline(block.text, key)}</div>
      }
      case 'paragraph':
        return <p key={key} style={css.mdParagraph}>{parseInline(block.lines.join(' '), key)}</p>
      case 'code':
        return renderCode(block.lang, block.lines, key)
      case 'hr':
        return <hr key={key} style={css.mdHr} />
      case 'quote':
        return (
          <blockquote key={key} style={css.mdQuote}>
            {parseBlocks(block.lines).map((inner, bi) => renderBlock(inner, `${key}-q${bi}`))}
          </blockquote>
        )
      case 'list':
        return (
          <div key={key} style={css.mdList}>
            {block.items.map((item, ii) => (
              <div key={`${key}-i${ii}`} style={css.mdListItem}>
                <span style={css.mdListMarker} aria-hidden="true">
                  {listMarker(block.ordered, ii)}
                </span>
                <span style={css.mdListItemText}>
                  {parseInline(item.text, `${key}-i${ii}`)}
                  {item.children.map((child, ci) => renderBlock(child, `${key}-i${ii}-c${ci}`))}
                </span>
              </div>
            ))}
          </div>
        )
      case 'table':
        return (
          <div key={key} style={css.mdTableWrap}>
            <table style={css.mdTable}>
              <thead>
                <tr style={css.mdTableRowHead}>
                  {block.header.map((cell, ci) => (
                    <th key={ci} style={css.mdTableHead}>{parseInline(cell, `${key}-h${ci}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} style={css.mdTableRow}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={css.mdTableCell}>{parseInline(cell, `${key}-r${ri}c${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  }

  return (
    <div style={{ ...css.mdContainer, fontSize }}>
      {source.trim() === ''
        ? <div style={css.emptyNote}>{t('diff.renderedEmpty')}</div>
        : blocks.map((block, bi) => renderBlock(block, String(bi)))}
      {truncated && (
        <div style={css.emptyNote}>{t('diff.truncated').replace('{count}', String(MAX_MARKDOWN_ROWS))}</div>
      )}
    </div>
  )
}

/**
 * 由 unified diff 文本重建「变更后」侧的完整源文本——渲染视图的数据源。
 * host 的 diff 查询带 -U999999 全量上下文，buildSideBySide 的行序列即
 * 覆盖整个文件；右侧流（上下文+新增）拼接即完整新侧内容（纯新增/
 * 修改/暂存基线均成立；空 diff → 空文本）。纯函数，可单测。
 */
export function renderedSourceOf(diffText: string): string {
  const rows = buildSideBySide(diffText)
  return buildStream(rows, 'right').map((line) => line.text).join('\n')
}
