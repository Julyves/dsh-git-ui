/**
 * Framework-free read-only query runner (history / diff / show / branches).
 *
 * Same layering as `core.ts`/`actions.ts`: structural injection, testable
 * against real temporary repositories without a cordis runtime. Every query
 * resolves the workspace once, then runs one or two read-only git commands
 * against the repository root.
 */
import { resolveWorkspace, runCommand, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import { parseBranchOutput, parseGraphLogOutput, parseNameStatusOutput, parseShowMeta } from './parser.ts'
import { isSafePath, operationError } from './actions.ts'
import type { GitBranch, GitQueryRequest, GitQueryResponse } from './types.ts'

/** Machine-readable log format for show queries (no parents). */
const LOG_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%aI'
/** 带图的 log 格式（%P = 父提交，%D = ref 装饰）。 */
const GRAPH_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D'

/** History page size cap (and default). 千条级 + 无限滚动。 */
const MAX_HISTORY_LIMIT = 1000

/** A ref is acceptable when non-empty and free of whitespace. */
function isValidRef(ref: string): boolean {
  return ref !== '' && !/\s/.test(ref)
}

/**
 * 执行一条只读查询。结果均为 JSON 纯数据且有界
 * （history 分页；diff 文本受 runner 的 spill/截断约束）。
 * `config` 当前未用：保留以与 runAction 共享 runner 签名契约
 * （deps, config, request），后续查询限流等调优可直接启用。
 */
export async function runQuery(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  request: GitQueryRequest,
): Promise<GitQueryResponse> {
  void config
  // turn-records 由宿主编排层(host/index.ts 的 TurnRecordsBackend)处理;
  // 本文件只负责 git 只读查询——此分支是穷尽性安全网,正常不会到达。
  if (request.query.kind === 'turn-records') {
    return { ok: false, error: { code: 'git-error', message: 'turn-records handled by the record backend' } }
  }
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return { ok: false, error: operationError(workspace.error).error }
  const root = workspace.root
  const query = request.query

  switch (query.kind) {
    case 'history':
      return historyQuery(deps, root, query)
    case 'diff':
      return diffQuery(deps, root, query.path, query.base)
    case 'show':
      return showQuery(deps, root, query.ref)
    case 'branches':
      return branchesQuery(deps, root)
    case 'tags':
      return tagsQuery(deps, root)
    case 'authors':
      return authorsQuery(deps, root)
  }
}

async function historyQuery(
  deps: SnapshotDeps,
  root: string,
  query: Extract<GitQueryRequest['query'], { kind: 'history' }>,
): Promise<GitQueryResponse> {
  const safeLimit = Math.min(Math.max(Math.floor(query.limit), 0), MAX_HISTORY_LIMIT)
  const safeSkip = Math.max(Math.floor(query.skip), 0)
  if (query.ref !== undefined && !isValidRef(query.ref)) {
    return { ok: false, error: { code: 'invalid-name', message: `invalid ref: ${query.ref}` } }
  }
  const search = query.search?.trim() ?? ''
  const hexLike = /^[0-9a-f]{7,40}$/i.test(search)
  // 哈希精准检索：仅定位目标提交自身（--no-walk 不遍历祖先）→ 单条目，
  // 不再列出该提交的全部祖先；文本搜索走 --grep（-i -E，跨引用匹配）。
  const scope = hexLike ? [] : query.ref === undefined ? ['--all'] : [query.ref]
  const noWalk = hexLike ? ['--no-walk', search] : []
  const filters: string[] = []
  if (search !== '' && !hexLike) filters.push('--regexp-ignore-case', '--extended-regexp', `--grep=${search}`)
  const author = query.author?.trim() ?? ''
  if (author !== '') filters.push(`--author=${author}`)
  const since = query.since?.trim() ?? ''
  if (since !== '') filters.push(`--since=${since}`)

  const log = await runCommand(
    deps.run,
    // -n/--skip 前置：git 的 `-n N` 出现在 `--no-walk` 之后会重置 no-walk
    // （hexLike 会错误列出全部祖先），前置则 `-n 1000 --no-walk x` 恒返回单条。
    ['git', 'log', ...filters, `--skip=${String(safeSkip)}`, '-n', String(safeLimit), ...noWalk, ...scope, `--format=${GRAPH_FORMAT}`],
    root,
    'log',
    deps.signal,
  )
  if ('failure' in log) return { ok: false, error: operationError(log.failure).error }
  if (log.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (log.run.exitCode !== 0) {
    // 未出生仓库无提交：git log 以 128 此信息退出——稳定空历史，非错误。
    if (log.run.stderr.includes('does not have any commits')) {
      return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
    }
    // 哈希无解析（未命中）或前缀不唯一（ambiguous）：稳定空结果（让用户输入更长前缀）。
    if (hexLike && /unknown revision|bad revision|ambiguous/i.test(log.run.stderr)) {
      return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
    }
    return gitError('log', log.run.stderr, log.run.stdout)
  }

  // 过滤范围内的提交总数（best-effort）。
  let total = 0
  const count = await runCommand(deps.run, ['git', 'rev-list', '--count', ...noWalk, ...scope, ...filters], root, 'rev-list', deps.signal)
  if ('run' in count && count.run.exitCode === 0) {
    const parsed = Number(count.run.stdout.trim())
    if (Number.isFinite(parsed) && parsed >= 0) total = parsed
  }

  // 远程名用于 %D 装饰的远程分支分类；失败时降级为空列表（其余按本地分支处理）。
  let remotes: readonly string[] = []
  const remoteRun = await runCommand(deps.run, ['git', 'remote'], root, 'remote', deps.signal)
  if ('run' in remoteRun && remoteRun.run.exitCode === 0) {
    remotes = remoteRun.run.stdout.split('\n').map((s) => s.trim()).filter((s) => s !== '')
  }

  return { ok: true, value: { kind: 'history', commits: parseGraphLogOutput(log.run.stdout, remotes), total } }
}

/**
 * 单文件差异（变更界面对照查看用）。
 * staged = --cached；worktree = 工作区对索引；
 * 未版本管理文件 worktree 差异为空 → 回退 --no-index 与 /dev/null 对比（退出码 1 视为有差异的成功）。
 */
async function diffQuery(
  deps: SnapshotDeps,
  root: string,
  path: string,
  base: 'worktree' | 'staged',
): Promise<GitQueryResponse> {
  if (!isSafePath(path, root)) return { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } }
  // 使用 -U999999 显示完整文档上下文（而非仅变更 hunk），支持文档浏览体验。
  const argv = base === 'staged'
    ? ['git', 'diff', '--cached', '-U999999', '--', path]
    : ['git', 'diff', '-U999999', '--', path]
  const run = await runCommand(deps.run, argv, root, 'diff', deps.signal)
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return gitError('diff', run.run.stderr, run.run.stdout)
  if (run.run.stdout !== '' || base === 'staged') {
    return { ok: true, value: { kind: 'diff', path, text: run.run.stdout } }
  }
  // 空差异：可能是未版本管理文件——与 /dev/null 对比生成全增差异。
  const ni = await runCommand(deps.run, ['git', 'diff', '--no-index', '-U999999', '--', '/dev/null', path], root, 'diff --no-index', deps.signal)
  if ('failure' in ni) return { ok: false, error: operationError(ni.failure).error }
  if (ni.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (ni.run.exitCode !== 0 && ni.run.exitCode !== 1) return gitError('diff', ni.run.stderr, ni.run.stdout)
  return { ok: true, value: { kind: 'diff', path, text: ni.run.stdout } }
}

async function showQuery(deps: SnapshotDeps, root: string, ref: string): Promise<GitQueryResponse> {
  if (!isValidRef(ref)) return { ok: false, error: { code: 'invalid-name', message: `invalid ref: ${ref}` } }
  // -s 仅输出格式块：%b 为排除首段落后的正文，独立调用避免解析歧义。
  const meta = await runCommand(
    deps.run,
    ['git', 'show', '-s', `--format=${LOG_FORMAT}%x1f%b`, ref],
    root,
    'show',
    deps.signal,
  )
  if ('failure' in meta) return { ok: false, error: operationError(meta.failure).error }
  if (meta.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (meta.run.exitCode !== 0) return gitError('show', meta.run.stderr, meta.run.stdout)

  const stat = await runCommand(
    deps.run,
    ['git', '-c', 'core.quotePath=false', 'show', '--format=', '--name-status', '-z', ref],
    root,
    'show --name-status',
    deps.signal,
  )
  if ('failure' in stat) return { ok: false, error: operationError(stat.failure).error }
  if (stat.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (stat.run.exitCode !== 0) return gitError('show', stat.run.stderr, stat.run.stdout)

  const parsed = parseShowMeta(meta.run.stdout)
  return {
    ok: true,
    value: {
      kind: 'show',
      ref,
      commit: parsed?.commit ?? null,
      body: parsed?.body ?? '',
      stats: parseNameStatusOutput(stat.run.stdout),
    },
  }
}

/** 作者列表（工具栏用户选择用），去重排序截断 100。 */
async function authorsQuery(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const run = await runCommand(deps.run, ['git', 'log', '--all', '-n', '1000', '--format=%an'], root, 'log authors', deps.signal)
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return { ok: true, value: { kind: 'authors', authors: [] } }
  const authors = [...new Set(run.run.stdout.split('\n').map((s) => s.trim()).filter((s) => s !== ''))].sort().slice(0, 100)
  return { ok: true, value: { kind: 'authors', authors } }
}

/** 标签列表（左栏过滤树用），复用 tab 分隔解析。 */
async function tagsQuery(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const FORMAT = '--format=%(refname:short)%09%(objectname:short)'
  const run = await runCommand(deps.run, ['git', 'tag', FORMAT], root, 'tag', deps.signal)
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return gitError('tag', run.run.stderr, run.run.stdout)
  return { ok: true, value: { kind: 'tags', tags: parseBranchList(run.run.stdout) } }
}

async function branchesQuery(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  // 本地分支格式：name\thash\tupstream\ttrack（track 如 [ahead 2, behind 1]）。
  // 远程分支无上游 → upstream/track 为空。
  const LOCAL_FORMAT = '--format=%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(upstream:track)'
  const REMOTE_FORMAT = '--format=%(refname:short)%09%(objectname:short)'
  const local = await runCommand(deps.run, ['git', 'branch', LOCAL_FORMAT], root, 'branch', deps.signal)
  if ('failure' in local) return { ok: false, error: operationError(local.failure).error }
  if (local.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (local.run.exitCode !== 0) return gitError('branch', local.run.stderr, local.run.stdout)

  const remote = await runCommand(deps.run, ['git', 'branch', '-r', REMOTE_FORMAT], root, 'branch -r', deps.signal)
  if ('failure' in remote) return { ok: false, error: operationError(remote.failure).error }
  if (remote.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (remote.run.exitCode !== 0) return gitError('branch -r', remote.run.stderr, remote.run.stdout)

  const current = await runCommand(deps.run, ['git', 'branch', '--show-current'], root, 'branch', deps.signal)
  const currentName = 'run' in current && current.run.exitCode === 0 ? parseBranchOutput(current.run.stdout) : null

  // 默认分支：origin/HEAD 符号引用（如 origin/main）；失败降级 null。
  let defaultBranch: string | null = null
  const def = await runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root, 'symbolic-ref', deps.signal)
  if ('run' in def && def.run.exitCode === 0) {
    const value = def.run.stdout.trim()
    const slash = value.indexOf('/')
    defaultBranch = value === '' ? null : slash === -1 ? value : value.slice(slash + 1)
  }

  return {
    ok: true,
    value: {
      kind: 'branches',
      current: currentName,
      defaultBranch,
      local: parseBranchList(local.run.stdout),
      remote: parseBranchList(remote.run.stdout).filter((branch) => !branch.name.endsWith('/HEAD')),
    },
  }
}

/**
 * 解析 `%(refname:short)%09%(objectname:short)[%09%(upstream:short)%09%(upstream:track)]` 行。
 * 本地分支含 4 字段（upstream + track），远程分支仅 2 字段（无上游）。
 * track 格式：`[ahead N]`、`[behind N]`、`[ahead N, behind N]` 或空（无上游/已同步）。
 */
function parseBranchList(output: string): readonly GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    const name = parts[0]
    const hash = parts[1]
    if (name === undefined || name === '') continue
    const track = parts[3] ?? ''
    const aheadMatch = /ahead (\d+)/.exec(track)
    const behindMatch = /behind (\d+)/.exec(track)
    const ahead = aheadMatch ? Number(aheadMatch[1]) : 0
    const behind = behindMatch ? Number(behindMatch[1]) : 0
    branches.push({
      name,
      shortHash: hash === undefined || hash === '' ? null : hash,
      ...(ahead > 0 ? { ahead } : {}),
      ...(behind > 0 ? { behind } : {}),
    })
  }
  return branches
}

function gitError(label: string, stderr: string, stdout: string): GitQueryResponse {
  const message = stderr.trim() || stdout.trim()
  return {
    ok: false,
    error: {
      code: 'git-error',
      message: message !== '' ? message : `git ${label} failed`,
    },
  }
}
