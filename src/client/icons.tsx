/**
 * 通用内联 SVG 图标（纯组件，currentColor 着色，明暗主题自适应）。
 * 取代文本符号/emoji（☁  ▸ 等），保证跨平台渲染一致且跟随语义令牌。
 */
import type { JSX } from 'react'

/** 折叠/展开箭头：open 时旋转 90°，带平台快速过渡。 */
export function ChevronIcon({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      style={{
        display: 'block',
        flex: 'none',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)',
      }}
      aria-hidden="true"
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 目录图标（实心文件夹）。 */
export function FolderIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M1 3 a1 1 0 0 1 1-1 h2.6 l1.2 1.4 H10 a1 1 0 0 1 1 1 V9 a1 1 0 0 1-1 1 H2 a1 1 0 0 1-1-1 Z"
        fill="currentColor"
        opacity={0.75}
      />
    </svg>
  )
}

/** 文件图标（折角文档轮廓）。 */
export function FileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── 文件类型分类图标（同一折角轮廓 + 内部符号区分）──────────────────────

/** 代码文件图标（{ } 括号符号）。 */
export function CodeFileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M5 5.5 L4.2 7 L5 8.5 M7 5.5 L7.8 7 L7 8.5" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 配置文件图标（齿轮符号）。 */
export function ConfigFileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx={6} cy={7} r={1.4} fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M6 5 V5.6 M6 8.4 V9 M4.6 7 H5.2 M6.8 7 H7.4" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
    </svg>
  )
}

/** 文档文件图标（文本行符号）。 */
export function DocFileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M4.5 5 H7.5 M4.5 6.5 H7.5 M4.5 8 H6.5" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
    </svg>
  )
}

/** 图片文件图标（山峰符号）。 */
export function ImageFileIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3 1 h4 l2.5 2.5 V11 h-6.5 Z M7 1 v2.5 h2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M4 8.5 L5.5 6.5 L7 8.5 M6.5 8.5 L7.5 7 L8.5 8.5" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── 按扩展名/基名选择文件类型图标 ──────────────────────────────────────

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hxx', 'cs', 'vb', 'php', 'vue', 'svelte',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'lua', 'r', 'scala', 'clj', 'ex', 'exs',
  'erl', 'elm', 'dart', 'groovy', 'gradle', 'ml', 'fs', 'fsx', 'pl', 'pm', 'tcl',
])
const CONFIG_EXTS = new Set([
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'lock', 'properties',
  'editorconfig', 'gitignore', 'gitattributes', 'dockerignore', 'npmrc', 'prettierrc',
  'eslintrc', 'babelrc', 'node-version', 'nvmrc',
])
const DOC_EXTS = new Set([
  'md', 'mdx', 'txt', 'rst', 'pdf', 'doc', 'docx', 'rtf', 'adoc', 'org',
])
const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif',
])
const STYLESHEET_EXTS = new Set([
  'css', 'scss', 'sass', 'less', 'styl',
])

/** 按文件路径选择类型图标（扩展名/基名分类），不匹配时回退通用文件图标。
 * 目录条目（尾斜杠，如 `.agent/`）先剥尾斜杠再分类。纯点文件（`.agent` 的
 * 点即首字符）无扩展名语义：不把 `agent` 当后缀匹配代码/文档/图片等集合，
 * 仅白名单配置类 dotfile（`.gitignore`/`.npmrc` 等）给配置图标，其余通用文件图标。 */
export function fileIconForPath(path: string): JSX.Element {
  const clean = path.endsWith('/') ? path.slice(0, -1) : path
  const baseName = clean.slice(clean.lastIndexOf('/') + 1).toUpperCase()
  if (baseName === 'LICENSE' || baseName === 'README' || baseName === 'CHANGELOG' || baseName === 'AUTHORS') return <DocFileIcon />
  if (baseName === 'MAKEFILE' || baseName === 'DOCKERFILE' || baseName === 'CMAKECACHE') return <CodeFileIcon />
  const dot = clean.lastIndexOf('.')
  if (dot === -1) return <FileIcon />
  const ext = clean.slice(dot + 1).toLowerCase()
  // 纯点文件：点即首字符（如 `.agent`）——不把首段当扩展名参与类型分类。
  if (dot === 0) return CONFIG_EXTS.has(ext) ? <ConfigFileIcon /> : <FileIcon />
  if (CODE_EXTS.has(ext)) return <CodeFileIcon />
  if (CONFIG_EXTS.has(ext)) return <ConfigFileIcon />
  if (DOC_EXTS.has(ext)) return <DocFileIcon />
  if (IMAGE_EXTS.has(ext)) return <ImageFileIcon />
  if (STYLESHEET_EXTS.has(ext)) return <CodeFileIcon />
  return <FileIcon />
}

/** 分支图标（git branch）。 */
export function BranchIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <circle cx={3.5} cy={2.5} r={1.5} fill="currentColor" />
      <circle cx={3.5} cy={9.5} r={1.5} fill="currentColor" />
      <circle cx={8.5} cy={2.5} r={1.5} fill="currentColor" />
      <path d="M3.5 4 v4 M8.5 4 c0 2.5-2.5 2.5-4.5 3" fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}


/** 星形图标（默认/main 分支标识，IDEA 式）。 */
export function StarIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M6 0.8 l1.5 3.1 3.4 0.45 -2.5 2.35 0.65 3.35 L6 8.45 l-3.05 1.6 0.65-3.35 -2.5-2.35 3.4-0.45 Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 全部展开（双箭头下）。 */
export function ExpandAllIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block' }} aria-hidden="true">
      <path d="M2 1.5 L6 5 L10 1.5 M2 6 L6 9.5 L10 6" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 全部收起（双箭头上）。 */
export function CollapseAllIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block' }} aria-hidden="true">
      <path d="M2 4.5 L6 1 L10 4.5 M2 9 L6 5.5 L10 9" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 标签图标。 */
export function TagIcon(): JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M1.5 1.5 h4 l5 5 l-4 4 l-5-5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <circle cx={3.8} cy={3.8} r={0.9} fill="currentColor" />
    </svg>
  )
}

// ── Changes 行悬停操作图标（IDEA 式：对照/暂存/取消暂存/回滚）────────────

/** 对照查看图标：并排双栏窗格。 */
export function DiffIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <rect x={1.5} y={2.5} width={11} height={9} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <path d="M7 2.5 v9" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}

/** 暂存图标（加号：加入暂存区）。 */
export function StageIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M7 3 v8 M3 7 h8" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/** 取消暂存图标（减号：移出暂存区）。 */
export function UnstageIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3 7 h8" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/** 回滚（丢弃）图标：撤销箭头。 */
export function RollbackIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path
        d="M5.5 3 L3 5.5 L5.5 8 M3.4 5.5 h5.1 a3 3 0 0 1 0 6 h-2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 上一个（左箭头）。 */
export function PrevIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M8.5 3 L4.5 7 L8.5 11" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 设置（齿轮）：hub 圆 + 外圈 body + 8 个方头短齿径向咬合外圈。 */
export function GearIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      {/* hub（轴孔）与 body（轮盘）双圈 + 齿；齿用方头（butt）短段——圆头细射
          线会被读作「太阳/亮度」（历史版本的误读形态），齿轮齿必须方头且
          内端咬住外圈，与圈连成一体。 */}
      <circle cx={7} cy={7} r={2.1} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <circle cx={7} cy={7} r={3.9} fill="none" stroke="currentColor" strokeWidth={1.1} />
      <path
        d="M7 1.7 V3.1 M7 10.9 V12.3 M1.7 7 H3.1 M10.9 7 H12.3 M3.25 3.25 L4.24 4.24 M10.75 3.25 L9.76 4.24 M3.25 10.75 L4.24 9.76 M10.75 10.75 L9.76 9.76"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="butt"
      />
    </svg>
  )
}

/** 下一个（右箭头）。 */
export function NextIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M5.5 3 L9.5 7 L5.5 11" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 对勾（干净空状态 / 完成语义）。 */
export function CheckIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 提交（空历史语义）：节点 + 连接线。 */
export function CommitIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <circle cx={8} cy={8} r={2.4} fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M2.5 8 H5.6 M10.4 8 H13.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/** 记录（时钟）——turn 工作记录 Tab 语义图标。 */
export function RecordIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <circle cx={8} cy={8} r={5.6} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M8 5.2 V8 L10.2 9.4" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 关闭（叉号）。 */
export function CloseIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/** 告警三角（圆角填充 + 感叹号），用于告警横幅语义图标。 */
export function AlertIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block', flex: 'none' }} aria-hidden="true">
      <path d="M8 1.5 L14.5 13 L1.5 13 Z" fill="currentColor" opacity={0.15} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M8 6 V9.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={8} cy={11.3} r={0.8} fill="currentColor" />
    </svg>
  )
}

