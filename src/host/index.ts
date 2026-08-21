/**
 * dsh-git-ui host 适配层：Cordis/typert 壳。
 *
 * 本文件是 host 端**唯一** import `@deepseek-ai/*` 的地方。职责：
 *   1. 将 Cordis 服务（subprocess / sessions / sessionPersistence）适配为
 *      结构化 `SnapshotDeps` 接口；
 *   2. 调用 `createHostEndpoints(deps, config)` 获得纯业务端点；
 *   3. 以 `@Remote` 装饰器将端点暴露给 typert Gateway。
 *
 * 业务逻辑全部在 `contracts/host-endpoints.ts` → `host/core.ts` /
 * `host/actions.ts` / `host/queries.ts`，与框架无关。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import { createHostEndpoints, type HostEndpoints } from '../contracts/host-endpoints.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult } from './types.ts'

export type { GitSnapshot, GitSnapshotResult, GitSnapshotFailure, GitSnapshotRequest, GitCommit, GitChange, GitAction, GitActionResult, GitActionRequest, GitQuery, GitQueryResult, GitQueryRequest, GitQueryResponse, GitBranch, GitFileStat, GitRef } from './types.ts'
export { normalizeConfig, DEFAULT_CONFIG } from './core.ts'
export { parseStatusOutput, parseLogOutput, parseBranchOutput, parseNameStatusOutput } from './parser.ts'
export { isSafePath, isValidBranchName, runAction } from './actions.ts'
export { runQuery } from './queries.ts'
export { createHostEndpoints, type HostEndpoints } from '../contracts/host-endpoints.ts'

/** Cordis sessions 服务的结构化切片。 */
interface SessionsLike {
  get(id: string): { readonly header?: { readonly cwd?: string } } | undefined
}

/** Cordis sessionPersistence 服务的结构化切片。 */
interface SessionPersistenceLike {
  inspect(id: string): Promise<{ readonly meta: { readonly cwd?: string } }>
}

/**
 * gitInfo Remote 服务：Cordis 壳。
 *
 * 构造时从 Cordis Context 取出宿主服务，适配为 `SnapshotDeps`，再调用
 * `createHostEndpoints` 获得纯业务端点。三个 `@Remote` 方法仅做委托。
 */
export class GitStatusService extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'sessionPersistence']

  private readonly endpoints: HostEndpoints

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitInfo')
    const normalizedConfig = normalizeConfig(config)
    const deps = this.buildDeps(ctx, normalizedConfig)
    this.endpoints = createHostEndpoints(deps, normalizedConfig)
  }

  /** 将 Cordis 服务适配为结构化 SnapshotDeps。 */
  private buildDeps(ctx: Context, config: GitStatusConfig): SnapshotDeps {
    const subprocess = ctx.get('subprocess') as SubprocessLike | undefined
    if (subprocess === undefined) {
      // 返回一个永远失败的 deps——端点调用会走到 git-unavailable 降级路径。
      return {
        run: { run: async () => { throw new Error('subprocess service unavailable') } },
        fs: { realpath, stat },
        sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined },
      }
    }
    const sessions = ctx.get('sessions') as SessionsLike | undefined
    const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
    return {
      run: createGitRunner(subprocess, config.timeoutMs, config.maxStatusBytes),
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
    }
  }

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    return this.endpoints.snapshot(request, signal)
  }

  @Remote('run')
  async run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult> {
    return this.endpoints.run(request, signal)
  }

  @Remote('query')
  async query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse> {
    return this.endpoints.query(request, signal)
  }
}

export default GitStatusService
