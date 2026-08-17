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
import { operationError } from './actions.ts'
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
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return { ok: false, error: operationError(workspace.error).error }
  const root = workspace.root
  const query = request.query

  switch (query.kind) {
    case 'history':
      return historyQuery(deps, root, query)
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
  // 哈希前缀跳转：前缀直接作 rev 范围；文本搜索走 --grep（-i -E）。
  const scope = hexLike ? [search] : query.ref === undefined ? ['--all'] : [query.ref]
  const filters: string[] = []
  if (search !== '' && !hexLike) filters.push('--regexp-ignore-case', '--extended-regexp', `--grep=${search}`)
  const author = query.author?.trim() ?? ''
  if (author !== '') filters.push(`--author=${author}`)
  const since = query.since?.trim() ?? ''
  if (since !== '') filters.push(`--since=${since}`)

  const log = await runCommand(
    deps.run,
    ['git', 'log', ...scope, ...filters, `--skip=${String(safeSkip)}`, '-n', String(safeLimit), `--format=${GRAPH_FORMAT}`],
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
    // 哈希前缀无解析：稳定空结果（跳转未命中）。
    if (hexLike && /unknown revision|bad revision/.test(log.run.stderr)) {
      return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
    }
    return gitError('log', log.run.stderr, log.run.stdout)
  }

  // 过滤范围内的提交总数（best-effort）。
  let total = 0
  const count = await runCommand(deps.run, ['git', 'rev-list', '--count', ...scope, ...filters], root, 'rev-list', deps.signal)
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
  // git branch --format supports %09 (tab) but not %xNN escapes — tab it is.
  const FORMAT = '--format=%(refname:short)%09%(objectname:short)'
  const local = await runCommand(deps.run, ['git', 'branch', FORMAT], root, 'branch', deps.signal)
  if ('failure' in local) return { ok: false, error: operationError(local.failure).error }
  if (local.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (local.run.exitCode !== 0) return gitError('branch', local.run.stderr, local.run.stdout)

  const remote = await runCommand(deps.run, ['git', 'branch', '-r', FORMAT], root, 'branch -r', deps.signal)
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

/** Parse `%(refname:short)%09%(objectname:short)` rows (tab-separated). */
function parseBranchList(output: string): readonly GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [name, hash] = line.split('\t')
    if (name === undefined || name === '') continue
    branches.push({ name, shortHash: hash === undefined || hash === '' ? null : hash })
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
