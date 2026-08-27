import { memo } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { GitRef, GraphCommit } from '../../../host/types.ts'
import type { GitKey } from '../../locales.ts'
import { colorOf, GRAPH_COLORS, type GraphRowMarker } from '../../git-graph.ts'
import * as css from '../../styles.ts'
import { timeAgo, GRAPH_NODE_R, GRAPH_NODE_MIN_R } from '../shared.ts'

export function dotColorOf(hash: string): string {
  return colorOf(hash)
}

/** 提交行：memo 化保证千条级加载下过滤/选中变更仅重渲染受影响行。 */

export const CommitRow = memo(function CommitRow({
  row, cols, laneW, gridTpl, isSelected, now, onSelect, showGraph, t,
}: {
  row: GraphRowMarker
  cols: number
  laneW: number
  gridTpl: string
  isSelected: boolean
  now: number
  onSelect: (commit: GraphCommit) => void
  showGraph: boolean
  t: (key: GitKey) => string
}): JSX.Element {
  const isMerge = row.commit.parents.length > 1
  return (
    <button
      type="button"
      className="dsh-git-ui__commit-row"
      aria-current={isSelected ? 'true' : undefined}
      style={{
        ...(isSelected ? { ...css.historyRow, ...css.historyRowSelected } : css.historyRow),
        gridTemplateColumns: gridTpl,
      }}
      onClick={() => onSelect(row.commit)}
    >
      {showGraph ? (
        <GraphStrip row={row} cols={cols} laneW={laneW} endOpen={row.endOpen} selected={isSelected} />
      ) : (
        <span style={css.searchDot} aria-hidden="true">
          <span
            style={{
              ...css.searchDotInner,
              background: dotColorOf(row.commit.hash),
              // 选中态与图列节点同语言：细环 + 外圈同色低透明光晕（无动画——
              // 搜索态无 SVG，纯 boxShadow 光晕即足够的落定感）。
              ...(isSelected
                ? {
                  boxShadow: '0 0 0 2px var(--dsw-alias-state-business-primary), 0 0 0 5px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)',
                }
                : {}),
            }}
          />
        </span>
      )}
      <span style={css.historySubjectCell}>
        <RefPills refs={row.commit.refs} />
        {/* IDEA 式：merge 提交（多父）主题弱化——不喧宾夺主，与普通提交区分。
            选中态（V7）：主题文字泛业务色辉光（通电语汇），merge 同样适用。 */}
        <span
          style={{
            ...(isMerge ? { ...css.commitSubjectLine, ...css.commitSubjectMerge } : css.commitSubjectLine),
            ...(isSelected ? css.commitSubjectGlow : {}),
          }}
          title={row.commit.subject}
        >
          {row.commit.subject}
        </span>
      </span>
      <span style={css.historyHash} title={row.commit.hash}>{row.commit.shortHash}</span>
      <span style={css.historyAuthor} title={row.commit.author}>{row.commit.author}</span>
      <span style={css.historyTime}>{timeAgo(row.commit.dateIso, now, t)}</span>
    </button>
  )
})



// ── refs 胶囊 ───────────────────────────────────────────────────────────

/**
 * 提交行内的分支/标签胶囊（IDEA 风格）：当前分支成功色、
 * 本地分支中性、远程弱化、标签警示色。最多展示 3 个，其余折叠为 +n。
 */

export function RefPills({ refs }: { refs: readonly GitRef[] }): JSX.Element | null {
  if (refs.length === 0) return null
  const shown = refs.slice(0, 3)
  const rest = refs.length - shown.length
  const variant = (ref: GitRef): CSSProperties => {
    if (ref.head) return css.refPillHead
    switch (ref.kind) {
      case 'tag': return css.refPillTag
      case 'remote': return css.refPillRemote
      default: return css.refPillBranch
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: 'none', minWidth: 0 }} title={refs.map((r) => r.name).join(', ')}>
      {shown.map((ref) => (
        <span key={`${ref.kind}-${ref.name}`} style={{ ...css.refPill, ...variant(ref) }}>
          {ref.name}
        </span>
      ))}
      {rest > 0 && <span style={{ ...css.refPill, ...css.refPillRemote }}>+{rest}</span>}
    </span>
  )
}

// ── SVG graph strip ────────────────────────────────────────────────────────

/**
 * 一行的分支图：条带高度 = HISTORY_ROW_H（与行高同一常量），行间线条连续。
 *
 * 颜色（IDEA 式）：由 git-graph 算法随行交付的 `lineColors`/`nodeColor`——
 * 每条线 = 其源分支链色（同链恒一色，跨行同色延续；汇聚线保持各自子链色）。
 * 线条等权细线（1.5px 全色，无分层透明度）——IDEA 日志图的统一权重语汇。
 * 选中行：business 色柔光晕（r+7 实心 18%）+ 细环（r+3，240ms 落定动画），
 * 与右侧详情面板锚定联动。
 */

export function GraphStrip({
  row, cols, laneW, endOpen, selected,
}: {
  row: GraphRowMarker
  cols: number
  laneW: number
  endOpen?: boolean
  selected?: boolean
}): JSX.Element {
  const w = Math.max(cols, 1) * laneW
  const h = css.HISTORY_ROW_H
  const x = (col: number): number => col * laneW + laneW / 2
  const cy = h / 2
  const nodeR = Math.max(GRAPH_NODE_MIN_R, Math.min(GRAPH_NODE_R, laneW / 3))
  /** 车道线色：行内解析色优先，缺失回退车道索引色（兼容旧数据）。 */
  const colorOfLane = (col: number): string => row.lineColors?.[col] ?? GRAPH_COLORS[col % GRAPH_COLORS.length]!
  /** 节点色：所在链色（行内已解析；回退车道索引色）。 */
  const nodeColor = row.nodeColor ?? colorOfLane(row.column)
  return (
    // overflow visible：选中光晕（r+8）与细环在极窄车道（laneW=8 的 24+ 列图）
    // 下会超出 SVG 边界——放行视觉溢出（display:block 不影响布局，仅选中行绘制）。
    <svg width={w} height={h} className={selected === true ? 'dsh-git-ui__graph dsh-git-ui__graph--glow' : 'dsh-git-ui__graph'} style={{ display: 'block', flexShrink: 0, overflow: 'visible' }} aria-hidden="true">
      {row.verticals.map((col) => (
        // openLanes(H6):merge 副父等非节点延续线在过滤下贯到图尾未解析——
        // 末行以虚线 + 端止横杠标示(与 endOpen 诚实提示一致)。
        row.openLanes?.includes(col) === true
          ? (
            <g key={`v-${col}`}>
              <line x1={x(col)} y1={0} x2={x(col)} y2={h - 5} stroke={colorOfLane(col)} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
              <line x1={x(col) - 4} y1={h - 5} x2={x(col) + 4} y2={h - 5} stroke={colorOfLane(col)} strokeWidth={1.5} strokeLinecap="round" />
            </g>
          )
          : (
            <line key={`v-${col}`} x1={x(col)} y1={0} x2={x(col)} y2={h} stroke={colorOfLane(col)} strokeWidth={1.5} strokeLinecap="round" />
          )
      ))}
      {row.nodeFromTop && (
        // 来线段：上游链色（分支起点行的来线保持上游色，与上行延续线连续）。
        <line x1={x(row.column)} y1={0} x2={x(row.column)} y2={cy} stroke={row.incomingColor ?? colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      )}
      {row.joins.map((join) => (
        <g key={`j-${join}`}>
          {/* 汇聚车道：各自子链色自上方竖线到节点高度，再水平连接线汇入节点（锚定父节点行）。 */}
          <line x1={x(join)} y1={0} x2={x(join)} y2={cy} stroke={colorOfLane(join)} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={x(join)} y1={cy} x2={x(row.column)} y2={cy} stroke={colorOfLane(join)} strokeWidth={1.5} strokeLinecap="round" />
        </g>
      ))}
      {row.nodeContinues && (endOpen === true ? (
        <>
          {/* 悬垂端头：父提交不在已加载集合（被过滤/边界），虚线 + 端止横杠，诚实提示上游未载入。 */}
          <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h - 5} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
          <line x1={x(row.column) - 4} y1={h - 5} x2={x(row.column) + 4} y2={h - 5} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
        </>
      ) : (
        <line x1={x(row.column)} y1={cy} x2={x(row.column)} y2={h} stroke={colorOfLane(row.column)} strokeWidth={1.5} strokeLinecap="round" />
      ))}
      {row.edges.map((edge, i) => (
        <path
          key={`e-${i}`}
          // 曲线控制点 0.4/0.6 交错：起段微陡、中段平缓、收段回陡——比中点控制更圆润的曲线。
          // 颜色 = 目标车道（被合并分支）侧链色——merge 分裂曲线承载的是被合并分支的
          // 走向（dev 汇入 main），须保持被合并分支源色；curve 不随 merge 节点色，
          // 否则从主分支节点弯向被合并分支的这段会提前染成合并目标色（用户可见的 bug）。
          d={`M ${x(edge.from)} ${cy} C ${x(edge.from)} ${cy + (h - cy) * 0.4}, ${x(edge.to)} ${cy + (h - cy) * 0.6}, ${x(edge.to)} ${h}`}
          fill="none"
          stroke={colorOfLane(edge.to)}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* 选中态（V7 · 赛博轨道）：大光晕（r+8 实心 30%）+ 细环落定动画；
       *  轨道整体发光由 svg 上的 --glow 类（drop-shadow）承担（见 globals）。 */}
      {selected === true && (
        <g className="dsh-git-ui__graph-sel">
          <circle cx={x(row.column)} cy={cy} r={nodeR + 8} fill="var(--dsw-alias-state-business-primary)" opacity={0.3} />
          <circle
            className="dsh-git-ui__sel-ring"
            cx={x(row.column)}
            cy={cy}
            r={nodeR + 3}
            fill="none"
            stroke="var(--dsw-alias-state-business-primary)"
            strokeWidth={1.5}
          />
        </g>
      )}
      <circle
        cx={x(row.column)}
        cy={cy}
        r={nodeR}
        fill={nodeColor}
        stroke="var(--dsw-alias-bg-layer-2)"
        strokeWidth={1.5}
      />
    </svg>
  )
}
