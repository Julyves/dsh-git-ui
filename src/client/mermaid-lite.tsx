/**
 * Mermaid 轻量渲染器（零依赖，markdown 渲染视图的围栏代码块专用）。
 *
 * 设计取舍：完整 mermaid 运行时 ~1MB+，与本项目 bundle 预算策略冲突
 *（语法高亮曾为 817KB 的 grammar 砍掉 ruby）。此处实现一个覆盖高频
 * 图形的**子集**渲染器：
 *   - flowchart / graph（TD、LR）：节点（矩形/圆角/菱形/双框/跑道）+
 *     边（实线/虚线/粗线箭头、|--标签--|、链式 A-->B-->C）+ subgraph 聚簇框；
 *   - sequenceDiagram：participant、消息箭头（->>/-->>/->/-->、自发自）、
 *     Note over。
 * 未覆盖的图形（state/gantt/pie 等）与解析失败的输入一律返回
 * { ok: false }——由调用方渲染「图表解析失败」提示（诚实降级，不静默画错）。
 *
 * 布局：流图按最长路径分层（Kahn 剥层，环内节点收尾到末层）；时序图按
 * 参与者列 + 消息行网格。全部纯函数（可单测），SVG 输出走宿主主题 token。
 */
import type { JSX } from 'react'
import * as css from './styles.ts'

// ── 图形模型 ───────────────────────────────────────────────────────────────

type FlowShape = 'rect' | 'round' | 'diamond' | 'stadium' | 'subroutine' | 'plain'

interface FlowNode {
  readonly id: string
  readonly label: string
  readonly shape: FlowShape
  /** subgraph 归属（id → 标题）；无归属为 null。 */
  readonly cluster: string | null
}

interface FlowEdge {
  readonly from: string
  readonly to: string
  readonly kind: 'solid' | 'dotted' | 'thick'
  readonly label: string | null
}

interface Subgraph {
  readonly id: string
  readonly title: string
}

interface FlowDiagram {
  readonly kind: 'flow'
  readonly dir: 'TD' | 'LR'
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  readonly subgraphs: readonly Subgraph[]
}

interface SeqActor {
  readonly id: string
  readonly label: string
}

interface SeqMessage {
  readonly from: string
  readonly to: string
  readonly dashed: boolean
  readonly text: string
}

interface SeqNote {
  readonly over: readonly string[]
  readonly text: string
}

interface SeqDiagram {
  readonly kind: 'sequence'
  readonly actors: readonly SeqActor[]
  readonly steps: readonly (SeqMessage | SeqNote)[]
}

export type Diagram = FlowDiagram | SeqDiagram

export type DiagramParse =
  | { readonly ok: true; readonly diagram: Diagram }
  | { readonly ok: false; readonly reason: string }

// ── flowchart 解析 ─────────────────────────────────────────────────────────

/** 节点 token：`id`、`id[ label ]`、`id(label)`、`id{label}`、`id([label])`、`id[[label]]`（label 可带引号）。 */
const NODE_TOKEN_RE = /^([A-Za-z0-9_.-]+)\s*(?:\(\[([^]*)\]\)|\[\[([^]*)\]\]|\[([^]*)\]|\(([^]*)\)|\{([^]*)\})?$/

function parseNodeToken(token: string): { id: string; label: string; shape: FlowShape } | null {
  const m = NODE_TOKEN_RE.exec(token.trim())
  if (m === null) return null
  const id = m[1]!
  if (id === '') return null
  const raw = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]
  if (raw === undefined) return { id, label: id, shape: 'plain' }
  const label = stripQuotes(raw.trim())
  const shape: FlowShape = m[2] !== undefined ? 'stadium'
    : m[3] !== undefined ? 'subroutine'
    : m[4] !== undefined ? 'rect'
    : m[5] !== undefined ? 'round'
    : 'diamond'
  return { id, label: label === '' ? id : label, shape }
}

function stripQuotes(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1)
  }
  return text
}

/** 边操作符（长优先）。 */
const EDGE_OPS = ['-.->', '-->', '==>', '->', '---', '--'] as const
type EdgeOp = typeof EDGE_OPS[number]

/** 在行中找第一个边操作符（跳过节点 label 内的字符——朴素按序探测，长 op 优先）。 */
function findEdgeOp(line: string): { op: EdgeOp; index: number } | null {
  let best: { op: EdgeOp; index: number } | null = null
  for (const op of EDGE_OPS) {
    const index = line.indexOf(op)
    if (index >= 0 && (best === null || index < best.index || (index === best.index && op.length > best.op.length))) {
      best = { op, index }
    }
  }
  return best
}

function opKind(op: EdgeOp): 'solid' | 'dotted' | 'thick' {
  if (op === '-.->') return 'dotted'
  if (op === '==>') return 'thick'
  return 'solid'
}

/** flowchart / graph 头。 */
const FLOW_HEAD_RE = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\s*$/i

/** 解析 flowchart 声明体（不含头行）。解析失败返回 reason。 */
function parseFlow(dirRaw: string, bodyLines: readonly string[]): DiagramParse {
  const dir: 'TD' | 'LR' = dirRaw === 'LR' ? 'LR' : 'TD'
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const subgraphs: Subgraph[] = []
  let clusterStack: string[] = []

  /** 记录节点（保持首次出现顺序；后见带形状定义覆盖 label/shape）。 */
  const note = (parsed: { id: string; label: string; shape: FlowShape }): void => {
    const cluster = clusterStack[clusterStack.length - 1] ?? null
    const prev = nodes.get(parsed.id)
    nodes.set(parsed.id, {
      id: parsed.id,
      label: parsed.shape === 'plain' && prev !== undefined ? prev.label : parsed.label,
      shape: parsed.shape === 'plain' && prev !== undefined ? prev.shape : parsed.shape,
      cluster: prev?.cluster ?? cluster,
    })
  }

  /** 解析一条「节点 (边 节点)*」链（A --> B --> C：右侧节点成为下一段左侧）。 */
  const parseChain = (line: string): string | null => {
    let rest = line
    let found = findEdgeOp(rest)
    while (found !== null) {
      const leftRaw = rest.slice(0, found.index)
      const left = parseNodeToken(leftRaw)
      if (left === null) return `无法解析节点：「${leftRaw.trim() || '(空)'}」`
      note(left)
      const op = found.op
      let after = rest.slice(found.index + op.length)
      let kind = opKind(op)
      let label: string | null = null
      // 边标签形态一：A -->|text| B
      const pipe = /^\s*\|([^|]*)\|\s*(.*)$/.exec(after)
      if (pipe !== null) {
        label = pipe[1]!.trim()
        after = pipe[2]!
      } else if (op === '--') {
        // 形态二：A -- text --> B（text 夹在 -- 与下一操作符之间）。
        const restOp = findEdgeOp(after)
        if (restOp !== null && (restOp.op === '-->' || restOp.op === '-.->' || restOp.op === '==>')) {
          const textBetween = after.slice(0, restOp.index).trim()
          if (textBetween !== '') {
            label = stripQuotes(textBetween)
            kind = opKind(restOp.op)
            after = after.slice(restOp.index + restOp.op.length)
          }
        }
      }
      const nextFound = findEdgeOp(after)
      const rightRaw = (nextFound === null ? after : after.slice(0, nextFound.index)).trim()
      const right = parseNodeToken(rightRaw)
      if (right === null) return `无法解析节点：「${rightRaw || '(空)'}」`
      note(right)
      edges.push({ from: left.id, to: right.id, kind, label })
      rest = after
      found = nextFound
    }
    // 无边：仅一个独立节点声明。
    const token = parseNodeToken(rest)
    if (token === null) return `无法解析节点：「${rest.trim() || '(空)'}」`
    note(token)
    return null
  }

  for (const rawLine of bodyLines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%')) continue
    if (/^subgraph\b/i.test(line)) {
      const m = /^subgraph\s+([A-Za-z0-9_.-]+)?\s*(?:\[(.+)\])?$/.exec(line)
      const id = m?.[1] ?? m?.[2] ?? `cluster-${subgraphs.length}`
      const title = m?.[2] !== undefined ? stripQuotes(m[2]!.trim()) : (m?.[1] ?? '')
      subgraphs.push({ id, title: title === '' ? id : title })
      clusterStack = [...clusterStack, id]
      continue
    }
    if (/^end$/i.test(line)) {
      clusterStack = clusterStack.slice(0, -1)
      continue
    }
    // 声明性行（样式类）不参与结构，静默忽略。
    if (/^(style|classDef|class|linkStyle|click)\b/.test(line)) continue
    const err = parseChain(line)
    if (err !== null) return { ok: false, reason: err }
  }
  if (clusterStack.length > 0) return { ok: false, reason: 'subgraph 未闭合（缺少 end）' }
  if (nodes.size === 0) return { ok: false, reason: '图中没有节点' }
  return { ok: true, diagram: { kind: 'flow', dir, nodes: [...nodes.values()], edges, subgraphs } }
}

// ── sequenceDiagram 解析 ───────────────────────────────────────────────────

const SEQ_PARTICIPANT_RE = /^participant\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i
const SEQ_MESSAGE_RE = /^([A-Za-z0-9_.-]+)\s*(->>|-->>|->|-->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/
const SEQ_NOTE_RE = /^Note\s+over\s+([A-Za-z0-9_.-]+)(?:\s*,\s*([A-Za-z0-9_.-]+))?\s*:\s*(.*)$/i

function parseSequence(bodyLines: readonly string[]): DiagramParse {
  const actors = new Map<string, SeqActor>()
  const steps: (SeqMessage | SeqNote)[] = []
  const order: string[] = []
  const ensureActor = (id: string, label?: string): void => {
    if (!actors.has(id)) {
      actors.set(id, { id, label: label ?? id })
      order.push(id)
    } else if (label !== undefined) {
      actors.set(id, { id, label })
    }
  }
  for (const rawLine of bodyLines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%')) continue
    if (/^(autonumber|activate|deactivate)\b/.test(line)) continue
    const p = SEQ_PARTICIPANT_RE.exec(line)
    if (p !== null) {
      ensureActor(p[1]!, p[2] !== undefined ? stripQuotes(p[2]!.trim()) : undefined)
      continue
    }
    const note = SEQ_NOTE_RE.exec(line)
    if (note !== null) {
      const over = [note[1]!, ...(note[2] !== undefined ? [note[2]] : [])].filter((id) => actors.has(id) || (ensureActor(id), true))
      if (over.length === 0) return { ok: false, reason: `Note 引用了未知参与者` }
      steps.push({ over, text: note[3]!.trim() })
      continue
    }
    const m = SEQ_MESSAGE_RE.exec(line)
    if (m !== null) {
      ensureActor(m[1]!)
      ensureActor(m[3]!)
      steps.push({
        from: m[1]!,
        to: m[3]!,
        dashed: m[2] === '-->' || m[2] === '-->>',
        text: m[4]!.trim(),
      })
      continue
    }
    return { ok: false, reason: `无法解析时序图语句：「${line}」` }
  }
  if (order.length === 0) return { ok: false, reason: '时序图没有参与者' }
  return {
    ok: true,
    diagram: { kind: 'sequence', actors: order.map((id) => actors.get(id)!), steps },
  }
}

/** 解析 mermaid 源文本。 */
export function parseMermaid(source: string): DiagramParse {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''))
  const head = lines.find((l) => l.trim() !== '')
  if (head === undefined) return { ok: false, reason: '空内容' }
  const flowHead = FLOW_HEAD_RE.exec(head.trim())
  if (flowHead !== null) {
    const rest = lines.slice(lines.indexOf(head) + 1)
    return parseFlow(flowHead[1]!.toUpperCase(), rest)
  }
  if (/^sequenceDiagram\s*$/i.test(head.trim())) {
    const rest = lines.slice(lines.indexOf(head) + 1)
    return parseSequence(rest)
  }
  return { ok: false, reason: `暂不支持的图形类型：「${head.trim().split(/\s+/)[0]}」（当前支持 flowchart/graph 与 sequenceDiagram）` }
}

// ── 布局与 SVG 几何（纯计算） ──────────────────────────────────────────────

interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 估算文本像素宽（12px 字号）。 */
const textW = (text: string, factor = 7): number => text.length * factor

function flowLayout(diagram: FlowDiagram): { svgW: number; svgH: number; boxes: Map<string, Box> } {
  const { dir, nodes, edges } = diagram
  const boxes = new Map<string, Box>()
  // 尺寸估算。
  const size = new Map<string, { w: number; h: number }>()
  for (const n of nodes) {
    const lw = Math.min(textW(n.label), 220)
    const w = Math.max(56, lw + 28)
    const h = n.shape === 'diamond' ? 46 : 36
    size.set(n.id, { w: n.shape === 'diamond' ? Math.max(w, 84) : w, h })
  }
  // Kahn 分层（最长路径）。
  const layerOf = new Map<string, number>()
  const indeg = new Map<string, number>()
  for (const n of nodes) indeg.set(n.id, 0)
  const seenEdge = new Set<string>()
  const dedupEdges = edges.filter((e) => {
    const key = `${e.from}\u0000${e.to}`
    if (seenEdge.has(key) || e.from === e.to) return false
    seenEdge.add(key)
    return true
  })
  for (const e of dedupEdges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  let queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  queue.forEach((id) => layerOf.set(id, 0))
  while (queue.length > 0) {
    const next: string[] = []
    for (const id of queue) {
      for (const e of dedupEdges) {
        if (e.from !== id) continue
        const target = e.to
        const candidate = (layerOf.get(id) ?? 0) + 1
        if (candidate > (layerOf.get(target) ?? 0)) layerOf.set(target, candidate)
        const left = (indeg.get(target) ?? 0) - 1
        indeg.set(target, left)
        if (left === 0) next.push(target)
      }
    }
    queue = next
  }
  // 环内残余节点：追加到当前最大层的下一层。
  let maxLayer = 0
  layerOf.forEach((v) => { if (v > maxLayer) maxLayer = v })
  for (const n of nodes) if (!layerOf.has(n.id)) layerOf.set(n.id, maxLayer + 1)
  // 分行/列。
  const layerCount = maxLayer + 2
  const rows: string[][] = Array.from({ length: layerCount }, () => [])
  for (const n of nodes) rows[layerOf.get(n.id) ?? 0]!.push(n.id)
  const nonEmpty = rows.filter((r) => r.length > 0)
  const GAP_MAIN = 64
  const GAP_CROSS = 22
  const PAD = 18
  let svgW = 0
  let svgH = 0
  if (dir === 'TD') {
    let y = PAD
    for (const row of nonEmpty) {
      const rowH = Math.max(...row.map((id) => size.get(id)!.h))
      const rowW = row.reduce((acc, id) => acc + size.get(id)!.w, 0) + GAP_CROSS * (row.length - 1)
      let cursor = PAD
      for (const id of row) {
        const s = size.get(id)!
        boxes.set(id, { x: cursor, y: y + (rowH - s.h) / 2, w: s.w, h: s.h })
        cursor += s.w + GAP_CROSS
      }
      y += rowH + GAP_MAIN
      svgW = Math.max(svgW, rowW + PAD * 2)
      svgH = y
    }
    svgH = svgH - GAP_MAIN + PAD
  } else {
    let x = PAD
    for (const row of nonEmpty) {
      const rowW = Math.max(...row.map((id) => size.get(id)!.w))
      const rowH = row.reduce((acc, id) => acc + size.get(id)!.h, 0) + GAP_CROSS * (row.length - 1)
      let cursor = PAD
      for (const id of row) {
        const s = size.get(id)!
        boxes.set(id, { x, y: cursor, w: s.w, h: s.h })
        cursor += s.h + GAP_CROSS
      }
      x += rowW + GAP_MAIN
      svgW = x
      svgH = Math.max(svgH, rowH + PAD * 2)
    }
    svgW = svgW - GAP_MAIN + PAD
  }
  return { svgW: Math.max(svgW, 120), svgH: Math.max(svgH, 60), boxes }
}

// ── SVG 渲染 ───────────────────────────────────────────────────────────────

/** 节点形状 path/元素。 */
function nodeShape(shape: FlowShape, b: Box, key: string): JSX.Element {
  const stroke = 'var(--dsw-alias-border-strong, var(--dsw-alias-border-l2))'
  const fill = 'var(--dsw-alias-bg-layer-2)'
  const common = { fill, stroke, strokeWidth: 1.2 }
  switch (shape) {
    case 'diamond':
      return (
        <polygon key={key} points={`${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`} {...common} />
      )
    case 'round':
    case 'stadium':
      return <rect key={key} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} {...common} />
    case 'subroutine':
      return (
        <g key={key}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} {...common} />
          <path d={`M ${b.x + 6} ${b.y} v ${b.h} M ${b.x + b.w - 6} ${b.y} v ${b.h}`} fill="none" stroke={stroke} strokeWidth={1} />
        </g>
      )
    default:
      return <rect key={key} x={b.x} y={b.y} width={b.w} height={b.h} rx={4} {...common} />
  }
}

const trimLabel = (text: string, max = 32): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** 流图 SVG。 */
function renderFlow(diagram: FlowDiagram, markerId: string): JSX.Element {
  const { svgW, svgH, boxes } = flowLayout(diagram)
  const arrow = 'var(--dsw-alias-label-secondary)'
  const dir = diagram.dir
  const edgePath = (e: FlowEdge): { d: string; lx: number; ly: number } => {
    const from = boxes.get(e.from)!
    const to = boxes.get(e.to)!
    // 正向边：TD 下出上进；LR 右出左进。同层/回边：侧面绕行。
    const forward = dir === 'TD' ? to.y > from.y : to.x > from.x
    if (forward) {
      const sx = dir === 'TD' ? from.x + from.w / 2 : from.x + from.w
      const sy = dir === 'TD' ? from.y + from.h : from.y + from.h / 2
      const tx = dir === 'TD' ? to.x + to.w / 2 : to.x
      const ty = dir === 'TD' ? to.y : to.y + to.h / 2
      const c = dir === 'TD' ? `C ${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}` : `C ${(sx + tx) / 2} ${sy}, ${(sx + tx) / 2} ${ty}`
      return { d: `M ${sx} ${sy} ${c}, ${tx} ${ty}`, lx: (sx + tx) / 2, ly: (sy + ty) / 2 }
    }
    // 侧绕（TD 走右侧、LR 走下方）。
    const bulge = 46
    if (dir === 'TD') {
      const sx = from.x + from.w
      const sy = from.y + from.h / 2
      const tx = to.x + to.w
      const ty = to.y + to.h / 2
      return { d: `M ${sx} ${sy} C ${sx + bulge} ${sy}, ${tx + bulge} ${ty}, ${tx} ${ty}`, lx: (sx + tx) / 2 + bulge / 2, ly: (sy + ty) / 2 }
    }
    const sx = from.x + from.w / 2
    const sy = from.y + from.h
    const tx = to.x + to.w / 2
    const ty = to.y + to.h
    return { d: `M ${sx} ${sy} C ${sx} ${sy + bulge}, ${tx} ${ty + bulge}, ${tx} ${ty}`, lx: (sx + tx) / 2, ly: (sy + ty) / 2 + bulge / 2 }
  }
  return (
    <svg viewBox={`0 0 ${Math.ceil(svgW)} ${Math.ceil(svgH)}`} style={css.mdDiagramSvg} role="img">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill={arrow} />
        </marker>
      </defs>
      {diagram.subgraphs.map((sg) => {
        const members = diagram.nodes.filter((n) => n.cluster === sg.id)
        if (members.length === 0) return null
        const boxesOf = members.map((n) => boxes.get(n.id)!)
        const minX = Math.min(...boxesOf.map((b) => b.x)) - 12
        const minY = Math.min(...boxesOf.map((b) => b.y)) - 26
        const maxX = Math.max(...boxesOf.map((b) => b.x + b.w)) + 12
        const maxY = Math.max(...boxesOf.map((b) => b.y + b.h)) + 12
        return (
          <g key={`sg-${sg.id}`}>
            <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={8}
              fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth={1} strokeDasharray="4 3" />
            <text x={minX + 8} y={minY + 14} fontSize={11} fill="var(--dsw-alias-label-tertiary)">{trimLabel(sg.title, 24)}</text>
          </g>
        )
      })}
      {diagram.edges.map((e, i) => {
        const { d, lx, ly } = edgePath(e)
        return (
          <g key={`e-${i}`}>
            <path d={d} fill="none" stroke={arrow} strokeWidth={e.kind === 'thick' ? 2.2 : 1.3}
              strokeDasharray={e.kind === 'dotted' ? '5 4' : undefined} markerEnd={`url(#${markerId})`} />
            {e.label !== null && e.label !== '' && (
              <g>
                <rect x={lx - textW(e.label, 6) / 2 - 4} y={ly - 8} width={textW(e.label, 6) + 8} height={16} rx={4}
                  fill="var(--dsw-alias-bg-layer-2)" />
                <text x={lx} y={ly + 4} fontSize={11} textAnchor="middle" fill="var(--dsw-alias-label-secondary)">{trimLabel(e.label, 20)}</text>
              </g>
            )}
          </g>
        )
      })}
      {diagram.nodes.map((n) => {
        const b = boxes.get(n.id)!
        return (
          <g key={`n-${n.id}`}>
            {nodeShape(n.shape, b, `s-${n.id}`)}
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} fontSize={12} textAnchor="middle"
              fill="var(--dsw-alias-label-primary)">{trimLabel(n.label)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** 时序图 SVG。 */
function renderSequence(diagram: SeqDiagram, markerId: string): JSX.Element {
  const { actors, steps } = diagram
  const colW = Math.max(...actors.map((a) => textW(a.label) + 36), 96)
  const gap = Math.max(colW / 2, 56)
  const xs = new Map<string, number>()
  actors.forEach((a, i) => xs.set(a.id, 24 + colW / 2 + i * (colW + gap)))
  const headH = 40
  const stepH = 38
  const svgW = 24 + actors.length * (colW + gap)
  const svgH = headH + 30 + steps.length * stepH + 26
  const line = 'var(--dsw-alias-border-l2)'
  const arrow = 'var(--dsw-alias-label-secondary)'
  return (
    <svg viewBox={`0 0 ${Math.ceil(svgW)} ${Math.ceil(svgH)}`} style={css.mdDiagramSvg} role="img">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill={arrow} />
        </marker>
      </defs>
      {actors.map((a) => {
        const x = xs.get(a.id)!
        return (
          <g key={`a-${a.id}`}>
            <rect x={x - colW / 2} y={10} width={colW} height={30} rx={6}
              fill="var(--dsw-alias-bg-layer-2)" stroke="var(--dsw-alias-border-strong, var(--dsw-alias-border-l2))" strokeWidth={1.2} />
            <text x={x} y={29} fontSize={12} textAnchor="middle" fill="var(--dsw-alias-label-primary)">{trimLabel(a.label, 18)}</text>
            <line x1={x} y1={headH} x2={x} y2={svgH - 16} stroke={line} strokeWidth={1} strokeDasharray="4 4" />
          </g>
        )
      })}
      {steps.map((step, i) => {
        const y = headH + 34 + i * stepH
        if ('over' in step) {
          const xsOf = step.over.map((id) => xs.get(id)).filter((v): v is number => v !== undefined)
          if (xsOf.length === 0) return null
          const left = Math.min(...xsOf) - colW / 2 + 4
          const right = Math.max(...xsOf) + colW / 2 - 4
          return (
            <g key={`s-${i}`}>
              <rect x={left} y={y - 14} width={Math.max(right - left, textW(step.text, 6) + 20)} height={26} rx={5}
                fill="var(--dsw-alias-interactive-bg-hover)" stroke="var(--dsw-alias-border-l2)" />
              <text x={(left + right) / 2} y={y + 3} fontSize={11} textAnchor="middle" fill="var(--dsw-alias-label-secondary)">{trimLabel(step.text, 40)}</text>
            </g>
          )
        }
        const from = xs.get(step.from)
        const to = xs.get(step.to)
        if (from === undefined || to === undefined) return null
        if (step.from === step.to) {
          // 自发自：右侧小回环。
          const loop = 26
          return (
            <g key={`s-${i}`}>
              <path d={`M ${from} ${y} h ${loop} v 16 h ${-loop}`} fill="none" stroke={arrow} strokeWidth={1.3}
                strokeDasharray={step.dashed ? '5 4' : undefined} markerEnd={`url(#${markerId})`} />
              <text x={from + loop + 8} y={y + 12} fontSize={11} fill="var(--dsw-alias-label-secondary)">{trimLabel(step.text, 26)}</text>
            </g>
          )
        }
        return (
          <g key={`s-${i}`}>
            <line x1={from} y1={y} x2={to} y2={y} stroke={arrow} strokeWidth={1.3}
              strokeDasharray={step.dashed ? '5 4' : undefined} markerEnd={`url(#${markerId})`} />
            <text x={(from + to) / 2} y={y - 6} fontSize={11} textAnchor="middle" fill="var(--dsw-alias-label-secondary)">{trimLabel(step.text, 30)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** 渲染一张已解析的图（markerId 需调用方保证 svg 内唯一）。 */
export function DiagramSvg({ diagram, markerId }: { readonly diagram: Diagram; readonly markerId: string }): JSX.Element {
  return diagram.kind === 'flow' ? renderFlow(diagram, markerId) : renderSequence(diagram, markerId)
}
