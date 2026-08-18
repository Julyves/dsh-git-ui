/**
 * Framework-free git management operation runner.
 *
 * Same layering as `core.ts`: every dependency is injected structurally, the
 * whole flow is testable against real temporary git repositories without a
 * cordis runtime, and `GitStatusService` only adapts host services into the
 * `SnapshotDeps` face.
 *
 * Security model: the browser only ever sends a `sessionId` plus
 * repository-relative paths (as listed in a snapshot's `changes`). Paths are
 * validated against the work-tree root (absolute paths and `..` escapes are
 * rejected) and every git invocation uses `--` so a path can never be
 * interpreted as an option. Commands run through the same subprocess adapter
 * as the read-only snapshot flow — no shell is involved.
 */
import { resolve, sep } from 'node:path'
import { resolveWorkspace, runCommand, snapshotForSession, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import type { GitAction, GitActionResult, GitActionRequest } from './types.ts'

/** Build the command sequence for one action, validating every path against the root. */
function buildArgv(action: GitAction, root: string): { readonly argv: readonly (readonly string[])[] } | { readonly error: string } {
  switch (action.kind) {
    case 'stage':
      return withPaths([['git', 'add', '--']], action.paths, root)
    case 'stage-all':
      return { argv: [['git', 'add', '-A']] }
    case 'unstage':
      return withPaths([['git', 'restore', '--staged', '--']], action.paths, root)
    case 'unstage-all':
      return { argv: [['git', 'restore', '--staged', '--', '.']] }
    case 'discard':
      return withPaths([['git', 'restore', '--']], action.paths, root)
    case 'discard-all':
      // Reset the index to HEAD first, then the work tree to the index — the
      // IDE-style "roll back everything tracked" semantics.
      return { argv: [['git', 'restore', '--staged', '--', '.'], ['git', 'restore', '--', '.']] }
    case 'commit': {
      // Message emptiness is validated by runAction (git-error), not here.
      const message = action.message.trim()
      if (action.paths === undefined || action.paths.length === 0) {
        return { argv: [['git', 'commit', '-m', message]] }
      }
      // 两步序列（IDE 式「提交所选文件」语义，含未跟踪文件）：
      // 1. `git add -- <paths>` 先把所选路径纳入索引——裸的
      //    `git commit -- <未跟踪路径>` 会报 pathspec 错误，先行暂存使其可匹配；
      // 2. `git commit -m <msg> -- <paths>` 按路径限定提交这些路径的工作区内容，
      //    其余已暂存文件不受影响。对已跟踪路径与单命令完全等价（已实测验证）。
      return withPaths([['git', 'add', '--'], ['git', 'commit', '-m', message, '--']], action.paths, root)
    }
    case 'branch-create': {
      // Name validity is validated by runAction (invalid-name), not here.
      const from = action.from === undefined || action.from === '' ? [] : [action.from]
      return { argv: [['git', 'branch', action.name, ...from]] }
    }
    case 'branch-checkout':
      return { argv: [['git', 'checkout', action.name]] }
    case 'branch-delete':
      return { argv: [['git', 'branch', action.force === true ? '-D' : '-d', action.name]] }
  }
}

/**
 * A branch name is valid when it matches git's ref-name grammar at the level
 * we care about: non-empty, ASCII ref chars only, no leading `-` (option
 * injection guard, though argv never shells out), no `..` (path traversal of
 * refs), no trailing `/`, and no double slashes.
 */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name.startsWith('-') || name.includes('..') || name.endsWith('/') || name.includes('//')) return false
  return /^[A-Za-z0-9._/-]+$/.test(name)
}

/**
 * 校验仓库相对路径后追加到 `--` 之后；`prefixes` 可给出多条命令序列，
 * 校验后的路径逐一附加到每条序列（commit 所选路径即两步序列）。
 */
function withPaths(prefixes: readonly (readonly string[])[], paths: readonly string[], root: string): { readonly argv: readonly (readonly string[])[] } | { readonly error: string } {
  if (paths.length === 0) return { error: 'no paths given' }
  for (const path of paths) {
    if (!isSafePath(path, root)) return { error: `unsafe path: ${path}` }
  }
  return { argv: prefixes.map((prefix) => [...prefix, ...paths]) }
}

/**
 * A path is safe when it is repo-relative and stays inside the work tree:
 * reject absolute paths, drive letters / backslashes, and `..` escapes
 * (checked via path resolution against the realpath'd root).
 */
export function isSafePath(path: string, root: string): boolean {
  if (path === '') return false
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false
  const resolved = resolve(root, path)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  return resolved === root || resolved.startsWith(prefix)
}

/** Map a snapshot-flow failure (which may carry git-unavailable) onto the operation error shape. */
export function operationError(failure: Extract<Awaited<ReturnType<typeof resolveWorkspace>>, { ok: false }>['error']): GitActionResult & { ok: false } {
  if (failure.code === 'git-unavailable') {
    return { ok: false, error: { code: 'git-error', message: failure.detail } }
  }
  return { ok: false, error: failure }
}

/**
 * Execute one management action against the session's repository and return
 * the refreshed snapshot on success (the caller re-renders from it, so the
 * UI never waits for the next poll).
 */
export async function runAction(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  request: GitActionRequest,
): Promise<GitActionResult> {
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return operationError(workspace.error)
  const root = workspace.root

  if (request.action.kind === 'commit' && request.action.message.trim() === '') {
    return { ok: false, error: { code: 'git-error', message: 'commit message is empty' } }
  }

  const kind = request.action.kind
  if (kind === 'branch-create' || kind === 'branch-checkout' || kind === 'branch-delete') {
    const name = request.action.name
    if (!isValidBranchName(name)) {
      return { ok: false, error: { code: 'invalid-name', message: `invalid branch name: ${name}` } }
    }
  }

  const built = buildArgv(request.action, root)
  if ('error' in built) return { ok: false, error: { code: 'invalid-path', message: built.error } }

  // Run the command sequence; a failure stops the rest (the first commands
  // may already have taken effect — they are all idempotent restores).
  let lastStdout = ''
  for (const argv of built.argv) {
    const outcome = await runCommand(deps.run, argv, root, `action ${request.action.kind}`, deps.signal)
    if ('failure' in outcome) return operationError(outcome.failure)
    if (outcome.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    if (outcome.run.exitCode !== 0) {
      // git writes user-facing failures to stderr OR stdout (e.g. a clean
      // repo's `git commit` reports "nothing to commit" on stdout).
      const message = outcome.run.stderr.trim() || outcome.run.stdout.trim()
      return {
        ok: false,
        error: {
          code: 'git-error',
          message: message !== '' ? message : `git ${request.action.kind} exited ${String(outcome.run.exitCode)}`,
        },
      }
    }
    lastStdout = outcome.run.stdout.trim()
  }

  const snapshot = await snapshotForSession(deps, config, request.sessionId)
  if (!snapshot.ok) return operationError(snapshot.error)
  return { ok: true, snapshot: snapshot.value, ...(lastStdout === '' ? {} : { output: lastStdout }) }
}
