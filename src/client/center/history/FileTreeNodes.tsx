import type { JSX } from 'react'
import { ChevronIcon, FileIcon, FolderIcon } from '../../icons.tsx'
import * as css from '../../styles.ts'
import type { FileTreeNode } from '../../file-tree.ts'

export function FileTreeNodes({
  nodes, collapsed, onToggle,
}: {
  nodes: readonly FileTreeNode[]
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
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
              />
            </div>
          )}
        </div>
      ) : (
        <div key={node.path} className="dsh-git-ui__row" style={css.treeRow}>
          <span style={{ ...css.treeCaret, visibility: 'hidden' }} aria-hidden="true"><ChevronIcon open={false} /></span>
          <span style={{ ...css.treeFolderIcon, color: css.statusTextColor[node.status ?? 'modified'] }}><FileIcon /></span>
          <span style={{ ...css.treeName, color: css.statusTextColor[node.status ?? 'modified'] }} title={node.path}>{node.name}</span>
        </div>
      ))}
    </>
  )
}


// ── 提交行（memo）与自绘下拉 ────────────────────────────────────────

/** 搜索条目装饰圆点取色：提交稳定散列色（复用分支图色板与 colorOf）。 */
