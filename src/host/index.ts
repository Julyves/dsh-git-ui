/**
 * dsh-git-ui host half: the `gitInfo` Remote service.
 *
 * Cordis shell only — every behavior lives in `core.ts` behind injected
 * structural faces, so tests never need a cordis runtime. The class is a
 * plugin in its own right (class form), mounted by the bundle patch row with
 * the package name; the gateway exposes `gitInfo/snapshot` through SRC
 * discovery (`typertRemote` binding + `@Remote` marker).
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, snapshotForSession, type GitStatusConfig } from './core.ts'
import type { GitSnapshotRequest, GitSnapshotResult } from './types.ts'

export type { GitSnapshot, GitSnapshotResult, GitSnapshotFailure, GitSnapshotRequest, GitCommit, GitChange } from './types.ts'
export { normalizeConfig, DEFAULT_CONFIG } from './core.ts'
export { parseStatusOutput, parseLogOutput, parseBranchOutput } from './parser.ts'

/** Structural face of a live session header. */
interface SessionLike {
  readonly header?: { readonly cwd?: string }
}

/** Structural face of the sessions service. */
interface SessionsLike {
  get(id: string): SessionLike | undefined
}

/** Structural face of the session-persistence service. */
interface SessionPersistenceLike {
  inspect(id: string): Promise<{ readonly meta: { readonly cwd?: string } }>
}

/** The `gitInfo` service: one `snapshot` Remote endpoint. */
export class GitStatusService extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'sessionPersistence']

  private readonly config: GitStatusConfig

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitInfo')
    this.config = normalizeConfig(config)
  }

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    const subprocess = this.ctx.get('subprocess') as SubprocessLike | undefined
    if (subprocess === undefined) {
      return { ok: false, error: { code: 'git-unavailable', detail: 'subprocess service unavailable' } }
    }
    const sessions = this.ctx.get('sessions') as SessionsLike | undefined
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
    const runner = createGitRunner(subprocess, this.config.timeoutMs, this.config.maxStatusBytes)
    return snapshotForSession(
      {
        run: runner,
        fs: { realpath, stat },
        sessions: {
          liveCwd: (id) => sessions?.get(id)?.header?.cwd,
          persistedMeta: async (id) => {
            if (persistence === undefined) return undefined
            try {
              const inspection = await persistence.inspect(id)
              return { cwd: inspection.meta.cwd }
            } catch {
              return undefined
            }
          },
        },
        signal,
      },
      this.config,
      request.sessionId,
    )
  }
}

export default GitStatusService
