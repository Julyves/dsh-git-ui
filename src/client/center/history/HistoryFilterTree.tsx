import { useState } from 'react'
import type { JSX } from 'react'
import type { GitBranch } from '../../../host/types.ts'
import { BranchIcon, ChevronIcon, FolderIcon, StarIcon, TagIcon } from '../../icons.tsx'
import type { GitKey } from '../../locales.ts'
import * as css from '../../styles.ts'

export function HistoryFilterTree({
  tree, filter, onFilter, closed, onToggleSection, onFetch, fetching, fetchNote, t,
}: {
  tree: {
    current: string | null
    defaultBranch: string | null
    local: readonly GitBranch[]
    remote: readonly GitBranch[]
    tags: readonly GitBranch[]
  } | null
  filter: { kind: 'all' } | { kind: 'ref'; name: string }
  onFilter: (filter: { kind: 'all' } | { kind: 'ref'; name: string }) => void
  closed: ReadonlySet<string>
  onToggleSection: (section: string) => void
  onFetch: () => Promise<void>
  fetching: boolean
  fetchNote: string | null
  t: (key: GitKey) => string
}): JSX.Element {
  /** 搜索（分支或标签）：匹配行高亮，搜索时平铺展示并忽略折叠态。 */
  const [search, setSearch] = useState('')
  /** 分组文件夹（feat/xxx 等前缀组、远程 origin 组）的展开集：默认全收起
   *  ——分组本身即「收束归纳」语义，默认收起更规整；点开持续有效（组件
   *  随 Tab 常驻挂载，跨 Tab 切换保持）。与顶层 section（本地/远程/标签，
   *  默认展开）的 closed/onToggleSection 语义分离。 */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set())
  const toggleFolder = (key: string): void => {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  /** 搜索态自动视为全部展开（平铺展示忽略折叠态）。 */
  const folderOpen = (key: string): boolean => searching || openFolders.has(key)
  const q = search.trim().toLowerCase()
  const searching = q !== ''
  const matches = (name: string): boolean => !searching || name.toLowerCase().includes(q)
  const highlight = (name: string): JSX.Element | string => {
    if (!searching) return name
    const idx = name.toLowerCase().indexOf(q)
    if (idx === -1) return name
    return (
      <>
        {name.slice(0, idx)}
        <span style={css.treeMatch}>{name.slice(idx, idx + q.length)}</span>
        {name.slice(idx + q.length)}
      </>
    )
  }
  const amber = 'var(--dsw-alias-state-warn-primary)'
  /** 默认 ref 判定（B7）：全名比对——本地根分支 `main` 或远程默认分支
   * `origin/main`。不再用剥前缀 bare 比对：文件夹分支 `feature/main` 的 bare
   * 也是 'main'，会被误标默认分支星（它不是默认分支）。 */
  const isDefaultRef = (name: string): boolean =>
    tree !== null && tree.defaultBranch !== null && (name === tree.defaultBranch || name === `origin/${tree.defaultBranch}`)
  /** 分支图标与着色：当前检出 > 默认分支 > 普通。 */
  const branchFace = (name: string): { icon: JSX.Element; color?: string } => {
    if (tree !== null && name === tree.current) return { icon: <TagIcon />, color: amber }
    if (isDefaultRef(name)) return { icon: <StarIcon />, color: amber }
    return { icon: <BranchIcon /> }
  }
  const row = (name: string, bare: string, active: boolean, mark: boolean, indent: number, branch?: GitBranch): JSX.Element => {
    const face = branchFace(name)
    const hasSync = branch !== undefined && ((branch.ahead ?? 0) > 0 || (branch.behind ?? 0) > 0)
    return (
      <button
        // B4:key 在工厂内给出——row() 的全部 .map 调用点(本地/远程/搜索态/
        // 文件夹)产出的列表项由此获得稳定身份,消除 React unique-key 告警。
        // 分支全名在树内唯一(远程名恒含 '/',不与本地撞);tagRow 已有 key。
        key={name}
        type="button"
        className="dsh-git-ui__row"
        style={{ ...(active ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow), paddingLeft: indent, paddingTop: 3, paddingBottom: 3 }}
        onClick={() => onFilter({ kind: 'ref', name })}
        title={name}
      >
        <span style={face.color === undefined ? css.treeIcon : { ...css.treeIcon, color: face.color }} aria-hidden="true">{face.icon}</span>
        <span style={mark ? { ...css.treeName, ...css.treeNameCurrent } : css.treeName}>{highlight(bare)}</span>
        {hasSync && (
          <span style={css.treeSyncBadge}>
            {(branch!.ahead ?? 0) > 0 && `↑${branch!.ahead}`}
            {(branch!.ahead ?? 0) > 0 && (branch!.behind ?? 0) > 0 && ' '}
            {(branch!.behind ?? 0) > 0 && `↓${branch!.behind}`}
          </span>
        )}
        {mark && <span style={css.branchMark}>✓</span>}
      </button>
    )
  }
  const tagRow = (name: string): JSX.Element => (
    <button
      key={`t-${name}`}
      type="button"
      className="dsh-git-ui__row"
      style={{ ...(filter.kind === 'ref' && filter.name === name ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow), paddingLeft: 24 }}
      onClick={() => onFilter({ kind: 'ref', name })}
      title={name}
    >
      <span style={css.treeIcon} aria-hidden="true"><TagIcon /></span>
      <span style={css.treeName}>{highlight(name)}</span>
    </button>
  )
  const sectionHead = (key: string, label: string): JSX.Element => (
    <button type="button" style={css.treeSectionHead} onClick={() => onToggleSection(key)} aria-expanded={!closed.has(key)}>
      <ChevronIcon open={!closed.has(key)} />
      <span>{label}</span>
    </button>
  )
  // 远程按远程名分组为文件夹节点（IDEA 式 origin 文件夹）。
  const remoteGroups: Array<[string, readonly GitBranch[]]> = []
  if (tree !== null) {
    const map = new Map<string, GitBranch[]>()
    for (const b of tree.remote) {
      const slash = b.name.indexOf('/')
      const remoteName = slash === -1 ? b.name : b.name.slice(0, slash)
      const list = map.get(remoteName)
      if (list === undefined) map.set(remoteName, [b])
      else list.push(b)
    }
    remoteGroups.push(...map.entries())
  }
  // 本地分支：无斜杠直接平铺；带斜杠按第一段前缀聚合为可折叠文件夹（IDEA 式）。
  const localRoots: GitBranch[] = []
  const localFolders: Array<[string, readonly GitBranch[]]> = []
  if (tree !== null) {
    const map = new Map<string, GitBranch[]>()
    for (const b of tree.local) {
      const slash = b.name.indexOf('/')
      if (slash === -1) {
        localRoots.push(b)
        continue
      }
      const group = b.name.slice(0, slash)
      const list = map.get(group)
      if (list === undefined) map.set(group, [b])
      else list.push(b)
    }
    localFolders.push(...map.entries())
  }
  const bareOf = (name: string): string => name.slice(name.indexOf('/') + 1)
  return (
    <>
      <div style={css.paneHead}>
        <input
          className="dsh-git-ui__branch-input"
          style={css.treeSearch}
          placeholder={t('history.searchTree')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('history.searchTree')}
        />
        <button
          type="button"
          className="dsh-git-ui__refresh"
          style={css.treeFetchBtn}
          onClick={() => void onFetch()}
          disabled={fetching}
          aria-label={t('center.fetch')}
          title={t('center.fetch')}
        >
          {fetching ? t('center.fetching') : t('center.fetch')}
        </button>
      </div>
      {fetchNote !== null && <div style={css.treeFetchNote}>{fetchNote}</div>}
      <div style={css.historyTree}>
        <button
          type="button"
          className="dsh-git-ui__row"
          style={filter.kind === 'all' ? { ...css.treeRow, ...css.treeRowActive } : css.treeRow}
          onClick={() => onFilter({ kind: 'all' })}
        >
          <span style={css.treeIcon} aria-hidden="true"><BranchIcon /></span>
          <span style={css.treeName}>{t('history.allBranches')}</span>
        </button>
        {tree !== null && (searching ? (
          // 搜索态：匹配行平铺（本地→远程→标签），忽略折叠。
          <>
            {tree.local.filter((b) => matches(b.name)).map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24, b))}
            {tree.remote.filter((b) => matches(b.name)).map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, false, 24))}
            {tree.tags.filter((b) => matches(b.name)).map((b) => tagRow(b.name))}
          </>
        ) : (
          <>
            {tree.local.length > 0 && sectionHead('local', t('center.localBranches'))}
            {!closed.has('local') && localRoots.map((b) => row(b.name, b.name, filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 24, b))}
            {!closed.has('local') && localFolders.map(([group, branches]) => (
              <div key={`g-${group}`}>
                <button
                  type="button"
                  className="dsh-git-ui__row"
                  style={{ ...css.treeRow, paddingLeft: 24 }}
                  onClick={() => toggleFolder(`local:${group}`)}
                  aria-expanded={folderOpen(`local:${group}`)}
                >
                  <span style={css.treeCaret}><ChevronIcon open={folderOpen(`local:${group}`)} /></span>
                  <span style={css.treeFolderIcon}><FolderIcon /></span>
                  <span style={css.treeName}>{group}</span>
                </button>
                {folderOpen(`local:${group}`) && branches.map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, b.name === tree.current, 44, b))}
              </div>
            ))}
            {tree.remote.length > 0 && sectionHead('remote', t('center.remoteBranches'))}
            {!closed.has('remote') && remoteGroups.map(([remoteName, branches]) => (
              <div key={`g-${remoteName}`}>
                <button
                  type="button"
                  className="dsh-git-ui__row"
                  style={{ ...css.treeRow, paddingLeft: 24 }}
                  onClick={() => toggleFolder(`remote:${remoteName}`)}
                  aria-expanded={folderOpen(`remote:${remoteName}`)}
                >
                  <span style={css.treeCaret}><ChevronIcon open={folderOpen(`remote:${remoteName}`)} /></span>
                  <span style={css.treeFolderIcon}><FolderIcon /></span>
                  <span style={css.treeName}>{remoteName}</span>
                </button>
                {folderOpen(`remote:${remoteName}`) && branches.map((b) => row(b.name, bareOf(b.name), filter.kind === 'ref' && filter.name === b.name, false, 44))}
              </div>
            ))}
            {tree.tags.length > 0 && sectionHead('tags', t('history.tags'))}
            {!closed.has('tags') && tree.tags.map((b) => tagRow(b.name))}
          </>
        ))}
      </div>
    </>
  )
}

/** 右栏文件目录树：引导线缩进、文件夹/文件图标、目录文件计数、可折叠。
 * 文件仅展示变更清单（按状态着色），点击查看差异已按定位移除。 */
