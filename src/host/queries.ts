/**
 * Framework-free read-only query runner (history / diff / show / branches).
 *
 * Same layering as `core.ts`/`actions.ts`: structural injection, testable
 * against real temporary repositories without a cordis runtime. Every query
 * resolves the workspace once, then runs one or two read-only git commands
 * against the repository root.
 */
import { resolveWorkspace, runCommand, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import { parseBranchOutput, parseGraphLogOutput, parseLogOutput, parseStatOutput } from './parser.ts'
import { isSafePath, operationError } from './actions.ts'
import type { GitBranch, GitCommit, GitFileStat, GitQuery, GitQueryRequest, GitQueryResponse, GraphCommit } from './types.ts'

/** Machine-readable log format for show queries (no parents). */
const LOG_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%aI'
/** 带图的 log 格式（%P = 父提交，%D = ref 装饰）。 */
const GRAPH_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D'

/** History page size cap (and default). */
const MAX_HISTORY_LIMIT = 100

/** A ref is acceptable when non-empty and free of whitespace. */
function isValidRef(ref: string): boolean {
  return ref !== '' && !/\s/.test(ref)
}

/**
 * Execute one read-only query. All results are JSON-plain and bounded
 * (history paginated; diff text bounded by the runner's spill/truncation).
 */
export async function runQuery(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  request: GitQueryRequest,
): Promise<GitQueryResponse> {
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return { ok: false, error: operationError(workspace.error).error }
  const root = workspace.root
  const query = request.query

  switch (query.kind) {
    case 'history':
      return historyQuery(deps, root, query.limit, query.skip)
    case 'diff':
      return diffQuery(deps, root, query.path, query.base)
    case 'diff-commit':
      return diffCommitQuery(deps, root, query.path, query.ref)
    case 'show':
      return showQuery(deps, root, query.ref)
    case 'branches':
      return branchesQuery(deps, root)
  }
}

async function historyQuery(
  deps: SnapshotDeps,
  root: string,
  limit: number,
  skip: number,
): Promise<GitQueryResponse> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 0), MAX_HISTORY_LIMIT)
  const safeSkip = Math.max(Math.floor(skip), 0)

  const log = await runCommand(
    deps.run,
    ['git', 'log', '--all', `--skip=${String(safeSkip)}`, '-n', String(safeLimit), `--format=${GRAPH_FORMAT}`],
    root,
    'log',
    deps.signal,
  )
  if ('failure' in log) return { ok: false, error: operationError(log.failure).error }
  if (log.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (log.run.exitCode !== 0) {
    // An unborn repository has no commits: git log exits 128 with this
    // message — a stable empty history, not an error.
    if (log.run.stderr.includes('does not have any commits')) {
      return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
    }
    return gitError('log', log.run.stderr, log.run.stdout)
  }

  // Total commit count across all branches is best-effort.
  let total = 0
  const count = await runCommand(deps.run, ['git', 'rev-list', '--count', '--all'], root, 'rev-list', deps.signal)
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

async function diffQuery(
  deps: SnapshotDeps,
  root: string,
  path: string,
  base: 'worktree' | 'staged' | 'head',
): Promise<GitQueryResponse> {
  if (!isSafePath(path, root)) return { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } }
  const baseArg = base === 'staged' ? ['--cached'] : base === 'head' ? ['HEAD'] : []
  const run = await runCommand(deps.run, ['git', 'diff', ...baseArg, '--', path], root, 'diff', deps.signal)
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return gitError('diff', run.run.stderr, run.run.stdout)
  return { ok: true, value: { kind: 'diff', path, text: run.run.stdout } }
}

async function diffCommitQuery(
  deps: SnapshotDeps,
  root: string,
  path: string,
  ref: string,
): Promise<GitQueryResponse> {
  if (!isSafePath(path, root)) return { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } }
  if (!isValidRef(ref)) return { ok: false, error: { code: 'invalid-name', message: `invalid ref: ${ref}` } }
  // --format= suppresses the commit header so the output is pure unified diff.
  const run = await runCommand(deps.run, ['git', 'show', ref, '--format=', '--', path], root, 'show', deps.signal)
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return gitError('show', run.run.stderr, run.run.stdout)
  return { ok: true, value: { kind: 'diff-commit', path, ref, text: run.run.stdout } }
}

async function showQuery(deps: SnapshotDeps, root: string, ref: string): Promise<GitQueryResponse> {
  if (!isValidRef(ref)) return { ok: false, error: { code: 'invalid-name', message: `invalid ref: ${ref}` } }
  const run = await runCommand(
    deps.run,
    ['git', 'show', ref, `--format=${LOG_FORMAT}`, '--stat'],
    root,
    'show',
    deps.signal,
  )
  if ('failure' in run) return { ok: false, error: operationError(run.failure).error }
  if (run.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (run.run.exitCode !== 0) return gitError('show', run.run.stderr, run.run.stdout)

  // Output shape: `<format line>\n\n<stat block>`.
  const lines = run.run.stdout.split('\n')
  const firstLine = lines[0] ?? ''
  const commits = parseLogOutput(`${firstLine}\n`)
  const stats: readonly GitFileStat[] = parseStatOutput(lines.slice(1).join('\n'))
  return { ok: true, value: { kind: 'show', ref, commit: commits[0] ?? null, stats } }
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

  return {
    ok: true,
    value: {
      kind: 'branches',
      current: currentName,
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
