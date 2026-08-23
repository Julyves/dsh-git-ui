/**
 * dsh-git-ui host 适配层:Cordis/typert 壳。
 *
 * 本文件是 host 端**唯一** import `@deepseek-ai/*` 的地方。职责:
 *   1. 将 Cordis 服务(subprocess / sessions / sessionPersistence / tools)
 *      适配为结构化注入面;
 *   2. 调用 `createHostEndpoints(deps, config)` 获得纯业务端点;
 *   3. 以 `@Remote` 装饰器将端点暴露给 typert Gateway;
 *   4. Turn 工作记录编排:RecordStore 状态机 + 会话事件折叠 + 观测跟踪
 *      (随每次 snapshot/run 更新)+ obs 持久化(插件数据存储)。
 *
 * 业务逻辑全部在 `contracts/host-endpoints.ts` → `host/core.ts` /
 * `host/actions.ts` / `host/queries.ts` / `host/record-store.ts` /
 * `host/turn-records.ts`,与框架无关。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, resolveWorkspace, runCommand, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import { createPluginDataStore, resolvePluginDataRoot, type PluginDataFs } from './plugin-data.ts'
import { createHostEndpoints, type HostEndpoints } from '../contracts/host-endpoints.ts'
import { RecordStore, type CommitProbe } from './record-store.ts'
import { runTurnRecords, type TurnRecordSources } from './turn-records.ts'
import { parseNameStatusOutput } from './parser.ts'
import { sliceEvents, type SessionLike } from '../adapters/dsh/session-log.ts'
import { createToolPresenter, type ToolRegistryLike } from '../adapters/dsh/tools-presenter.ts'
import { collectSubagentWrites, type SessionsLike as SubagentSessionsLike } from '../adapters/dsh/subagent-adapter.ts'
import { sessionStorageKey } from './obs-file.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshot, GitSnapshotRequest, GitSnapshotResult, GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult } from './types.ts'
import type { MtimeSource } from './record-assembly.ts'

export type { GitSnapshot, GitSnapshotResult, GitSnapshotFailure, GitSnapshotRequest, GitCommit, GitChange, GitAction, GitActionResult, GitActionRequest, GitQuery, GitQueryResult, GitQueryRequest, GitQueryResponse, GitBranch, GitFileStat, GitRef, GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult, TurnWorkRecord, WorkEntry, WorkEntryState } from './types.ts'
export { normalizeConfig, DEFAULT_CONFIG } from './core.ts'
export { parseStatusOutput, parseLogOutput, parseBranchOutput, parseNameStatusOutput } from './parser.ts'
export { isSafePath, isValidBranchName, runAction } from './actions.ts'
export { runQuery } from './queries.ts'
export { createPluginDataStore, resolvePluginDataRoot, validateFileName } from './plugin-data.ts'
export { createHostEndpoints, type HostEndpoints } from '../contracts/host-endpoints.ts'
export { RecordStore, OBS_FLUSH_DEBOUNCE_MS, RECONCILE_PROBE_CAP } from './record-store.ts'
export { runTurnRecords, type TurnRecordSources } from './turn-records.ts'

/** Cordis sessions 服务的结构化切片(扩展:事件读取 + 子会话枚举)。 */
interface SessionsService extends SubagentSessionsLike {
  get(id: string): (SessionLike & { readonly header?: { readonly cwd?: string } }) | undefined
}

/** Cordis sessionPersistence 服务的结构化切片。 */
interface SessionPersistenceLike {
  inspect(id: string): Promise<{ readonly meta: { readonly cwd?: string } }>
}

/** mtime 精修的 stat 上限(与 maxChanges 同量级,防超大变更集拖慢组装)。 */
const MTIME_STAT_CAP = 200

/**
 * gitInfo Remote 服务:Cordis 壳。
 *
 * 构造时从 Cordis Context 取出宿主服务,适配为结构化面,再调用
 * `createHostEndpoints` 获得纯业务端点。三个 `@Remote` 方法仅做委托;
 * snapshot/run 成功后顺带更新 Turn 记录观测(折叠事件 + firstSeen 时间线
 * + HEAD 提交检测 + 去抖落盘)。`turn-records` 查询经编排层 `runTurnRecords`
 * 产出记录(查询走现有 query 端点路由)。
 */
export class GitStatusService extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'sessionPersistence']

  private readonly endpoints: HostEndpoints
  private readonly storage: ReturnType<typeof createPluginDataStore>
  private readonly records: RecordStore
  private readonly presenter: ReturnType<typeof createToolPresenter>
  private readonly sessions: SessionsService | undefined
  private readonly deps: SnapshotDeps
  private readonly probeRoots = new Map<string, string | null>()

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitInfo')
    const normalizedConfig = normalizeConfig(config)
    this.deps = this.buildDeps(ctx, normalizedConfig)
    this.sessions = ctx.get<SessionsService>('sessions')
    this.storage = createPluginDataStore(pluginDataFs(), {
      root: resolvePluginDataRoot(normalizedConfig.dshHome),
    })
    // 平台写意图解析面:tools 服务为可选(缺失 → args 目录兜底,见 write-paths.ts)。
    this.presenter = createToolPresenter(ctx.get<ToolRegistryLike>('tools'))
    this.records = new RecordStore((sessionId) => this.observationPersistence(sessionId))
    this.endpoints = createHostEndpoints(this.deps, normalizedConfig, {
      run: (sessionId, signal) => this.runTurnRecords(sessionId, signal),
    })
    this.wireLifecycle(ctx)
  }

  /** 将 Cordis 服务适配为结构化 SnapshotDeps。 */
  private buildDeps(ctx: Context, config: GitStatusConfig): SnapshotDeps {
    const subprocess = ctx.get<SubprocessLike | undefined>('subprocess')
    if (subprocess === undefined) {
      // 返回一个永远失败的 deps——端点调用会走到 git-unavailable 降级路径。
      return {
        run: { run: async () => { throw new Error('subprocess service unavailable') } },
        fs: { realpath, stat },
        sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined },
      }
    }
    const sessions = ctx.get<SessionsService | undefined>('sessions')
    const persistence = ctx.get<SessionPersistenceLike | undefined>('sessionPersistence')
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

  /** 生命周期接线:会话离开内存时冲刷并释放观测状态。 */
  private wireLifecycle(ctx: Context): void {
    ctx.on('session/disposed', (session: unknown) => {
      const id = (session as { id?: unknown } | null)?.id
      if (typeof id === 'string') this.records.disposeSession(id)
    })
    ctx.on('dispose', () => {
      this.records.flushAll()
    })
  }

  // ── 观测跟踪(snapshot/run 成功后随路更新) ────────────────────────────────

  private async track(sessionId: string, snapshot: GitSnapshot): Promise<void> {
    this.records.observe(sessionId, snapshot.changes, snapshot.checkedAt, snapshot.truncated)
    await this.records.noteHead(sessionId, snapshot.head, snapshot.checkedAt, (from, to) =>
      this.commitsBetween(sessionId, from, to))
  }

  /** HEAD 前移 → 提交路径集(git log old..new --name-status -z;失败返回空)。 */
  private async commitsBetween(sessionId: string, from: string, to: string): Promise<readonly string[]> {
    const workspace = await resolveWorkspace(this.deps, sessionId)
    if (!workspace.ok) return []
    const outcome = await runCommand(
      this.deps.run,
      ['git', 'log', '--format=', '--name-status', '-z', `${from}..${to}`],
      workspace.root,
      'log commits',
    )
    if ('failure' in outcome) return []
    if (outcome.run.timedOut || outcome.run.exitCode !== 0) return []
    return parseNameStatusOutput(outcome.run.stdout).map((row) => row.path)
  }

  /** mtime 精修源:对当前变更列表 stat(上限 MTIME_STAT_CAP;失败路径跳过)。 */
  private async mtimesFor(snapshot: GitSnapshot): Promise<MtimeSource | undefined> {
    const root = snapshot.root
    const values = new Map<string, number>()
    const paths = snapshot.changes.slice(0, MTIME_STAT_CAP)
    await Promise.all(paths.map(async (change) => {
      try {
        const info = await stat(join(root, change.path))
        if (typeof info.mtimeMs === 'number' && Number.isFinite(info.mtimeMs)) {
          values.set(change.path, info.mtimeMs)
        }
      } catch {
        // stat 失败(路径消失等):跳过该路径的精修。
      }
    }))
    return { mtime: (path) => values.get(path) }
  }

  /** 恢复对账探针:git log -1 -- <path> 判定是否已提交(workspace 惰性解析缓存)。 */
  private probeFor(sessionId: string): CommitProbe {
    return {
      isCommitted: async (path) => {
        let root = this.probeRoots.get(sessionId)
        if (root === undefined) {
          const workspace = await resolveWorkspace(this.deps, sessionId)
          root = workspace.ok ? workspace.root : null
          this.probeRoots.set(sessionId, root)
        }
        if (root === null || root === undefined) return false
        const outcome = await runCommand(
          this.deps.run,
          ['git', 'log', '-1', '--format=%h', '--', path],
          root,
          'probe log',
        )
        return 'run' in outcome && !outcome.run.timedOut && outcome.run.exitCode === 0
      },
    }
  }

  /** 观测持久化通道:插件数据存储 obs-<sessionKey>.jsonl(原子写/白名单/上限复用)。 */
  private observationPersistence(sessionId: string): { read(): Promise<string | null>; write(raw: string): Promise<void> } {
    const file = `obs-${sessionStorageKey(sessionId)}.jsonl`
    return {
      read: async () => {
        const result = await this.storage.read({ file } satisfies GitStorageReadRequest)
        if (!result.ok) return null // 不存在(null)与 IO 失败均按空处理
        return result.value
      },
      write: async (raw) => {
        const result = await this.storage.write({ file, data: raw } satisfies GitStorageWriteRequest)
        if (!result.ok) throw new Error(`obs write failed: ${result.error.message}`)
      },
    }
  }

  /** turn-records 编排(hook 进 query 端点路由)。 */
  private async runTurnRecords(sessionId: string, signal?: AbortSignal): Promise<GitQueryResponse> {
    const sources: TurnRecordSources = {
      sessionEvents: (id) => {
        const session = this.sessions?.get(id)
        return session === undefined ? undefined : sliceEvents(session)
      },
      snapshot: (id, sig) => this.snapshotWithTrack({ sessionId: id }, sig),
      presenter: this.presenter,
      mtimes: (snapshot) => this.mtimesFor(snapshot),
      subagentWrites: (id, root) => Promise.resolve(
        collectSubagentWrites(id, this.records.turns(id), this.sessions, root, this.presenter),
      ),
      probe: (id) => this.probeFor(id),
      now: () => Date.now(),
    }
    return runTurnRecords(this.records, sources, sessionId, signal)
  }

  /** snapshot + 随路观测跟踪(端点与 turn-records 共用)。 */
  private async snapshotWithTrack(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    const result = await this.endpoints.snapshot(request, signal)
    if (result.ok) {
      await this.track(request.sessionId, result.value)
    }
    return result
  }

  // ── @Remote 端点(仅委托) ─────────────────────────────────────────────────

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    return this.snapshotWithTrack(request, signal)
  }

  @Remote('run')
  async run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult> {
    const result = await this.endpoints.run(request, signal)
    if (result.ok) {
      await this.track(request.sessionId, result.snapshot)
    }
    return result
  }

  @Remote('query')
  async query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse> {
    return this.endpoints.query(request, signal)
  }

  @Remote('storageRead')
  async storageRead(request: GitStorageReadRequest): Promise<GitStorageReadResult> {
    return this.storage.read(request)
  }

  @Remote('storageWrite')
  async storageWrite(request: GitStorageWriteRequest): Promise<GitStorageWriteResult> {
    return this.storage.write(request)
  }
}

/** node:fs/promises 中插件数据存储需要的成员切片(结构注入,便于测试)。 */
function pluginDataFs(): PluginDataFs {
  return { readFile, writeFile, mkdir, rename, rm }
}

export default GitStatusService