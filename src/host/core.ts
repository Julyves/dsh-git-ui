/**
 * Framework-free snapshot orchestration: session cwd resolution + git command
 * sequence + frozen GitSnapshot assembly. Every dependency is injected
 * structurally, so the whole flow is testable without a cordis runtime; the
 * cordis shell (GitStatusService) only adapts host services into these faces.
 */
import { parseBranchOutput, parseLogOutput, parseStatusOutput } from './parser.ts'
import type { GitRunner } from './git.ts'
import type { GitSnapshot, GitSnapshotResult } from './types.ts'

/** Resolved plugin config (already normalized; see normalizeConfig). */
export interface GitStatusConfig {
  readonly timeoutMs: number
  readonly maxStatusBytes: number
  readonly maxChanges: number
  readonly defaultRefreshIntervalMs: number
  /**
   * Harness home 显式覆盖（dsh 惯例：`$DSH_HOME` → `~/.dsh` 之上的最高优先级）。
   * 插件数据存放于 `<home>/plugin-data/dsh-git-ui/`。
   */
  readonly dshHome?: string
  /**
   * 出厂预设设置(可选;来自 cordis.patch.yml config.defaultSettings)。
   * 缺省时 getPreset 返回 null,客户端回退到代码内 DEFAULT_SETTINGS。
   * 结构性透传(不校验)——wire 边界(客户端 zod)做最终校验。
   */
  readonly defaultSettings?: unknown
}

/** Session identity lookup: live first, persisted fallback. */
export interface SessionLookup {
  /** Live session cwd; undefined when the session is cold or absent in memory. */
  liveCwd(sessionId: string): string | undefined
  /**
   * Persisted session metadata; resolves to undefined when no persisted
   * session exists, and to `{ cwd }` (cwd possibly undefined) otherwise.
   */
  persistedMeta(sessionId: string): Promise<{ readonly cwd?: string } | undefined>
}

/** Filesystem primitives (node:fs/promises slices). */
export interface FsLike {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

/** Everything the snapshot flow needs beyond the session lookup. */
export interface SnapshotDeps {
  readonly run: GitRunner
  readonly fs: FsLike
  readonly sessions: SessionLookup
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number
  /** Caller-side cancellation (Remote `signal` slot): aborts in-flight git runs. */
  readonly signal?: AbortSignal
}

/** Defaults applied by normalizeConfig when a value is absent or invalid. */
export const DEFAULT_CONFIG: GitStatusConfig = {
  timeoutMs: 5000,
  maxStatusBytes: 4 * 1024 * 1024,
  maxChanges: 100,
  defaultRefreshIntervalMs: 30_000,
}

/** Coerce a raw patch config value into a validated GitStatusConfig. */
export function normalizeConfig(raw: unknown): GitStatusConfig {
  const value = (raw ?? {}) as Record<string, unknown>
  const numberOr = (key: string, fallback: number): number => {
    const candidate = value[key]
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : fallback
  }
  return {
    timeoutMs: numberOr('timeoutMs', DEFAULT_CONFIG.timeoutMs) || DEFAULT_CONFIG.timeoutMs,
    maxStatusBytes: numberOr('maxStatusBytes', DEFAULT_CONFIG.maxStatusBytes) || DEFAULT_CONFIG.maxStatusBytes,
    maxChanges: Math.floor(numberOr('maxChanges', DEFAULT_CONFIG.maxChanges) || DEFAULT_CONFIG.maxChanges),
    defaultRefreshIntervalMs: numberOr('defaultRefreshIntervalMs', DEFAULT_CONFIG.defaultRefreshIntervalMs),
    ...(typeof value.dshHome === 'string' && value.dshHome !== ''
      ? { dshHome: value.dshHome }
      : {}),
    ...(typeof value.defaultSettings === 'object' && value.defaultSettings !== null
      ? { defaultSettings: value.defaultSettings }
      : {}),
  }
}

/** Outcome of the cwd resolution step. */
type CwdResolution =
  | { readonly ok: true; readonly cwd: string }
  | { readonly ok: false; readonly error: Extract<GitSnapshotResult, { ok: false }>['error'] }

async function resolveCwd(sessions: SessionLookup, sessionId: string): Promise<CwdResolution> {
  const live = sessions.liveCwd(sessionId)
  if (live !== undefined) return { ok: true, cwd: live }
  const persisted = await sessions.persistedMeta(sessionId)
  if (persisted === undefined) return { ok: false, error: { code: 'session-not-found', sessionId } }
  if (persisted.cwd === undefined) return { ok: false, error: { code: 'cwd-unavailable', sessionId } }
  return { ok: true, cwd: persisted.cwd }
}

/** Classify a failed run outcome into a snapshot failure. */
function runFailure(result: { readonly timedOut: boolean }, detail: string): Extract<GitSnapshotResult, { ok: false }>['error'] {
  return result.timedOut ? { code: 'timeout' } : { code: 'git-unavailable', detail }
}

/** Run one command, mapping a spawn-level failure to a snapshot failure. */
export async function runCommand(
  runner: GitRunner,
  argv: readonly string[],
  cwd: string,
  label: string,
  signal?: AbortSignal,
): Promise<{ readonly run: Awaited<ReturnType<GitRunner['run']>> } | { readonly failure: Extract<GitSnapshotResult, { ok: false }>['error'] }> {
  try {
    return { run: await runner.run(argv, { cwd, ...(signal === undefined ? {} : { signal }) }) }
  } catch (error) {
    return { failure: { code: 'git-unavailable', detail: `${label}: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

/**
 * Resolve a session's repository workspace: cwd (live or persisted), the
 * realpath'd directory, and the git work-tree root via `rev-parse
 * --show-toplevel`. Shared by the snapshot flow and the operation runner.
 */
export type WorkspaceResolution =
  | { readonly ok: true; readonly cwd: string; readonly root: string }
  | { readonly ok: false; readonly error: Extract<GitSnapshotResult, { ok: false }>['error'] }

export async function resolveWorkspace(
  deps: SnapshotDeps,
  sessionId: string,
): Promise<WorkspaceResolution> {
  const resolved = await resolveCwd(deps.sessions, sessionId)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  let realCwd: string
  try {
    realCwd = await deps.fs.realpath(resolved.cwd)
    const stat = await deps.fs.stat(realCwd)
    if (!stat.isDirectory()) {
      return { ok: false, error: { code: 'path-not-found', path: realCwd } }
    }
  } catch {
    return { ok: false, error: { code: 'path-not-found', path: resolved.cwd } }
  }

  const toplevel = await runCommand(deps.run, ['git', 'rev-parse', '--show-toplevel'], realCwd, 'rev-parse', deps.signal)
  if ('failure' in toplevel) return { ok: false, error: toplevel.failure }
  if (toplevel.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (toplevel.run.exitCode !== 0) {
    // exit 128 covers both "not a git repository" (plain directory) and
    // other git failures (dubious ownership, unreadable work tree, …).
    // Only the former is a stable non-repo state; everything else surfaces
    // as git-unavailable with the actual reason instead of a misleading
    // "no git repository" pill.
    const stderr = toplevel.run.stderr
    if (!stderr.includes('not a git repository')) {
      return { ok: false, error: runFailure(toplevel.run, `git rev-parse failed: ${stderr.trim() || `exit ${String(toplevel.run.exitCode)}`}`) }
    }
    return { ok: false, error: { code: 'not-a-git-repo' } }
  }
  const root = toplevel.run.stdout.trim()
  if (root === '') return { ok: false, error: { code: 'not-a-git-repo' } }
  return { ok: true, cwd: realCwd, root }
}

/**
 * Build one frozen GitSnapshot for a session working directory.
 * Command sequence (all read-only; every command after the first runs with
 * the repository root as cwd):
 *   1. `git rev-parse --show-toplevel`      — repo detection (exit 128 → not-a-git-repo)
 *   2. `git branch --show-current`          — null when detached
 *   3. `git rev-parse --short HEAD`         — null + unborn when the repo has no commits
 *   4. `git status --porcelain=v1 -z --branch --untracked-files=all`
 *   5. `git log -n 5 --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI`
 *
 * --untracked-files=all：git 默认 normal 模式会把整目录未跟踪折叠为单条
 * `?? dir/`（尾斜杠）且不枚举其内部文件——隐藏目录（.agent/.tianqi 等）的
 * 变更因此从不进入变更清单。`all` 强制逐文件枚举（与 IDEA / VSCode 一致），
 * 内部文件得以展示；maxChanges 截断列表、maxStatusBytes spill 保计数精确，
 * 超大未跟踪树（如未 gitignore 的构建产物）经此路径优雅降级。
 */
export async function snapshotForSession(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  sessionId: string,
): Promise<GitSnapshotResult> {
  const workspace = await resolveWorkspace(deps, sessionId)
  if (!workspace.ok) return { ok: false, error: workspace.error }
  const root = workspace.root

  const branchRun = await runCommand(deps.run, ['git', 'branch', '--show-current'], root, 'branch', deps.signal)
  if ('failure' in branchRun) return { ok: false, error: branchRun.failure }
  if (branchRun.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  const branch = branchRun.run.exitCode === 0 ? parseBranchOutput(branchRun.run.stdout) : null

  const headRun = await runCommand(deps.run, ['git', 'rev-parse', '--short', 'HEAD'], root, 'rev-parse HEAD', deps.signal)
  if ('failure' in headRun) return { ok: false, error: headRun.failure }
  if (headRun.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  // A failed HEAD read (non-timeout) only nulls the hash: the authoritative
  // unborn flag comes from the status header below (`## No commits yet on
  // main`), so a corrupt repo is never misreported as "no commits".
  const head = headRun.run.exitCode === 0 ? (headRun.run.stdout.trim() || null) : null

  // --untracked-files=all：强制枚举未跟踪目录内部文件（根因修复——见模块注释）。
  const status = await runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], root, 'status', deps.signal)
  if ('failure' in status) return { ok: false, error: status.failure }
  if (status.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (status.run.exitCode !== 0) {
    return { ok: false, error: runFailure(status.run, `git status exited ${String(status.run.exitCode)}`) }
  }
  const parsed = parseStatusOutput(status.run.stdout, config.maxChanges)

  const log = await runCommand(deps.run, ['git', 'log', '-n', '5', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], root, 'log', deps.signal)
  if ('failure' in log) return { ok: false, error: log.failure }
  if (log.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  const recentCommits = log.run.exitCode === 0 ? parseLogOutput(log.run.stdout) : []

  const checkedAt = deps.now?.() ?? Date.now()
  const snapshot: GitSnapshot = {
    root,
    branch,
    head,
    unborn: parsed.unborn,
    dirty: parsed.staged + parsed.modified + parsed.untracked > 0,
    staged: parsed.staged,
    modified: parsed.modified,
    untracked: parsed.untracked,
    ahead: parsed.ahead,
    behind: parsed.behind,
    lastCommit: recentCommits[0] ?? null,
    recentCommits,
    changes: parsed.changes,
    truncated: parsed.truncated || ('run' in status && status.run.stdoutLossy),
    refreshIntervalMs: config.defaultRefreshIntervalMs,
    checkedAt,
  }
  return { ok: true, value: snapshot }
}
