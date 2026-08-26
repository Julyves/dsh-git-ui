import type { JSX } from 'react'
import { ChevronIcon, FileIcon, FolderIcon } from '../../icons.tsx'
import * as css from '../../styles.ts'
import type { FileTreeNode } from '../../file-tree.ts'
import type { GitKey } from '../../locales.ts'

export function FileTreeNodes({
  nodes, collapsed, onToggle, onOpenFile, t,
}: {
  nodes: readonly FileTreeNode[]
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  /** 文件行点击（提交详情深链到变更页）；缺省 = 纯展示（目录节点不受影响）。 */
  onOpenFile?: (path: string) => void
  t: (key: GitKey) => string
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => node.dir ? (
        <div key={node.path}>
          <button
            type="button"
            className="dsh-git-ui__row"
            style={css.treeRow}
            onClick={() => onToggle(node.path)}
            aria-expanded={!collapsed.has(node.path)}
          >
            <span style={css.treeCaret}><ChevronIcon open={!collapsed.has(node.path)} /></span>
            <span style={css.treeFolderIcon}><FolderIcon /></span>
            <span style={css.treeName}>{node.name}</span>
          </button>
          {!collapsed.has(node.path) && (
            <div style={css.treeChildren}>
              <FileTreeNodes
                nodes={node.children}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                t={t}
              />
            </div>
          )}
        </div>
      ) : (
        onOpenFile === undefined ? (
          <div key={node.path} className="dsh-git-ui__row" style={css.treeRow}>
            <span style={{ ...css.treeCaret, visibility: 'hidden' }} aria-hidden="true"><ChevronIcon open={false} /></span>
            <span style={{ ...css.treeFolderIcon, color: css.statusTextColor[node.status ?? 'modified'] }}><FileIcon /></span>
            <span style={{ ...css.treeName, color: css.statusTextColor[node.status ?? 'modified'] }} title={node.path}>{node.name}</span>
          </div>
        ) : (
          // 文件行可点击：在变更页查看该文件在此提交中的变更（__change-link
          // hover 反馈，与弹窗/记录页的深链行一致）。
          <button
            key={node.path}
            type="button"
            className="dsh-git-ui__row dsh-git-ui__change-link"
            style={css.treeRowFileBtn}
            title={`${node.path} — ${t('history.openFileDiff')}`}
            onClick={() => onOpenFile(node.path)}
          >
            <span style={{ ...css.treeCaret, visibility: 'hidden' }} aria-hidden="true"><ChevronIcon open={false} /></span>
            <span style={{ ...css.treeFolderIcon, color: css.statusTextColor[node.status ?? 'modified'] }}><FileIcon /></span>
            <span style={{ ...css.treeName, color: css.statusTextColor[node.status ?? 'modified'] }}>{node.name}</span>
          </button>
        )
      ))}
    </>
  )
}


// ── 提交行（memo）与自绘下拉 ────────────────────────────────────────

/** 搜索条目装饰圆点取色：提交稳定散列色（复用分支图色板与 colorOf）。 */
