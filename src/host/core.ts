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
async function runCommand(
  runner: GitRunner,
  argv: readonly string[],
  cwd: string,
  label: string,
): Promise<{ readonly run: Awaited<ReturnType<GitRunner['run']>> } | { readonly failure: Extract<GitSnapshotResult, { ok: false }>['error'] }> {
  try {
    return { run: await runner.run(argv, { cwd }) }
  } catch (error) {
    return { failure: { code: 'git-unavailable', detail: `${label}: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

/**
 * Build one frozen GitSnapshot for a session working directory.
 * Command sequence (all read-only; every command after the first runs with
 * the repository root as cwd):
 *   1. `git rev-parse --show-toplevel`      — repo detection (exit 128 → not-a-git-repo)
 *   2. `git branch --show-current`          — null when detached
 *   3. `git rev-parse --short HEAD`         — null + unborn when the repo has no commits
 *   4. `git status --porcelain=v1 -z --branch`
 *   5. `git log -n 5 --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI`
 */
export async function snapshotForSession(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  sessionId: string,
): Promise<GitSnapshotResult> {
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

  const toplevel = await runCommand(deps.run, ['git', 'rev-parse', '--show-toplevel'], realCwd, 'rev-parse')
  if ('failure' in toplevel) return { ok: false, error: toplevel.failure }
  if (toplevel.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (toplevel.run.exitCode !== 0) {
    return { ok: false, error: { code: 'not-a-git-repo' } }
  }
  const root = toplevel.run.stdout.trim()
  if (root === '') return { ok: false, error: { code: 'not-a-git-repo' } }

  const branchRun = await runCommand(deps.run, ['git', 'branch', '--show-current'], root, 'branch')
  const branch = 'run' in branchRun && branchRun.run.exitCode === 0 ? parseBranchOutput(branchRun.run.stdout) : null

  const headRun = await runCommand(deps.run, ['git', 'rev-parse', '--short', 'HEAD'], root, 'rev-parse HEAD')
  if ('failure' in headRun) return { ok: false, error: headRun.failure }
  const unborn = headRun.run.exitCode !== 0 || headRun.run.stdout.trim() === ''
  const head = unborn ? null : headRun.run.stdout.trim()

  const status = await runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--branch'], root, 'status')
  if ('failure' in status) return { ok: false, error: status.failure }
  if (status.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (status.run.exitCode !== 0) {
    return { ok: false, error: runFailure(status.run, `git status exited ${String(status.run.exitCode)}`) }
  }
  const parsed = parseStatusOutput(status.run.stdout, config.maxChanges)

  const log = await runCommand(deps.run, ['git', 'log', '-n', '5', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], root, 'log')
  const recentCommits = 'run' in log && log.run.exitCode === 0 ? parseLogOutput(log.run.stdout) : []

  const checkedAt = deps.now?.() ?? Date.now()
  const snapshot: GitSnapshot = {
    root,
    branch,
    head,
    unborn: parsed.unborn || unborn,
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
