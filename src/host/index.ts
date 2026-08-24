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
import { migrateSettings, DEFAULT_SETTINGS, type GitUISettings, type PopupSettings } from '../contracts/settings.ts'
import { RecordStore, type CommitProbe } from './record-store.ts'
import { runTurnRecords, type TurnRecordSources } from './turn-records.ts'
import { parseNameStatusOutput } from './parser.ts'
import { PathStateTracker, type PathStateProbe } from './path-state.ts'
import { sliceEvents, type SessionLike } from '../adapters/dsh/session-log.ts'
import { createToolPresenter, type ToolRegistryLike } from '../adapters/dsh/tools-presenter.ts'
import { collectSubagentWrites, type SessionsLike as SubagentSessionsLike } from '../adapters/dsh/subagent-adapter.ts'
import { collectSiblingWrites } from '../adapters/dsh/sibling-adapter.ts'
import { sessionStorageKey } from './obs-file.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshot, GitSnapshotRequest, GitSnapshotResult, GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult, GitPresetRequest, GitPresetResult } from './types.ts'
import type { MtimeSource } from './record-assembly.ts'

export type { GitSnapshot, GitSnapshotResult, GitSnapshotFailure, GitSnapshotRequest, GitCommit, GitChange, GitAction, GitActionResult, GitActionRequest, GitQuery, GitQueryResult, GitQueryRequest, GitQueryResponse, GitBranch, GitFileStat, GitRef, GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult, GitPresetRequest, GitPresetResult, TurnWorkRecord, WorkEntry, WorkEntryState } from './types.ts'
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

/** 去向探测的专用短超时(ms):探测是运维性低层操作,不允许一条卡死 git
 * 命令把单查询拖到默认 5s 超时 × 配额条数(25→8)的顺序放大。 */
const PROBE_TIMEOUT_MS = 2000

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
  /** 规范化后的插件 config(getPreset 读取 defaultSettings)。 */
  private readonly normalizedConfig: GitStatusConfig
  private readonly probeRoots = new Map<string, string | null>()
  /** 最近一次成功快照缓存(turn-records 复用,避免重复跑 git 命令风暴)。 */
  private readonly snapshotCache = new Map<string, GitSnapshot>()
  /** 去向判定缓存(每会话一份;gone 条目按配额渐进升级)。 */
  private readonly pathStates = new Map<string, PathStateTracker>()

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitInfo')
    this.normalizedConfig = normalizeConfig(config)
    this.deps = this.buildDeps(ctx, this.normalizedConfig)
    this.sessions = ctx.get<SessionsService>('sessions')
    this.storage = createPluginDataStore(pluginDataFs(), {
      root: resolvePluginDataRoot(this.normalizedConfig.dshHome),
    })
    // 平台写意图解析面:tools 服务为可选(缺失 → args 目录兜底,见 write-paths.ts)。
    this.presenter = createToolPresenter(ctx.get<ToolRegistryLike>('tools'))
    this.records = new RecordStore((sessionId) => this.observationPersistence(sessionId))
    this.endpoints = createHostEndpoints(this.deps, this.normalizedConfig, {
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

  /** 生命周期接线:会话离开内存时冲刷并释放观测状态与缓存。 */
  private wireLifecycle(ctx: Context): void {
    ctx.on('session/disposed', (session: unknown) => {
      const id = (session as { id?: unknown } | null)?.id
      if (typeof id === 'string') {
        this.records.disposeSession(id)
        this.snapshotCache.delete(id)
        this.probeRoots.delete(id)
        this.pathStates.delete(id)
      }
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

  /** 记录最近成功快照(turn-records 复用;只保留内存,dispose 随会话清理)。 */
  private cacheSnapshot(sessionId: string, snapshot: GitSnapshot): void {
    this.snapshotCache.set(sessionId, snapshot)
  }

  /**
   * turn-records 的快照源:优先复用最近一次成功快照(轮询/操作已随路跟踪);
   * 冷启动无缓存时才跑一次完整 snapshot。
   */
  private snapshotForRecords(sessionId: string, signal?: AbortSignal): Promise<GitSnapshotResult> {
    const cached = this.snapshotCache.get(sessionId)
    if (cached !== undefined) return Promise.resolve({ ok: true, value: cached })
    return this.snapshotWithTrack({ sessionId }, signal)
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

  /** 恢复对账探针:git log -1 -- <path> 判定是否已提交(workspace 惰性解析缓存)。
   * 注意:git log 对无匹配提交的路径是「无输出 + exit 0」——必须校验 stdout 非空,
   * 否则从未提交的消失文件会被误判为已提交(冒烟测试抓获的真实 bug)。
   * 探测命令带**专用短超时**(PROBE_TIMEOUT_MS):探测是运维性低层操作,
   * 不允许一条卡死的 git 探测把单查询拖到默认 5s 超时 × 配额条数。 */
  private probeFor(sessionId: string): CommitProbe {
    return {
      isCommitted: async (path) => {
        const root = await this.resolveRoot(sessionId)
        if (root === null) return false
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS)
        try {
          const outcome = await runCommand(
            this.deps.run,
            ['git', 'log', '-1', '--format=%h', '--', path],
            root,
            'probe log',
            timeout.signal,
          )
          return 'run' in outcome
            && !outcome.run.timedOut
            && outcome.run.exitCode === 0
            && outcome.run.stdout.trim() !== ''
        } finally {
          clearTimeout(timer)
        }
      },
    }
  }

  /** 去向权威探针(同族探针,供 gone 条目升级):有提交 → committed;否则 reverted。
   * 与恢复探针不同:超时/运行失败返回 **null(保持 gone,冷却后重试)**——
   * "没查完"≠"从未提交",不得把超时误标为 reverted(错误断言会被永久缓存)。 */
  private finalStateProbeFor(sessionId: string): PathStateProbe {
    return {
      finalState: async (path) => {
        const root = await this.resolveRoot(sessionId)
        if (root === null) return null
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), PROBE_TIMEOUT_MS)
        try {
          const outcome = await runCommand(
            this.deps.run,
            ['git', 'log', '-1', '--format=%h', '--', path],
            root,
            'probe final-state',
            timeout.signal,
          )
          if (!('run' in outcome) || outcome.run.timedOut) return null
          return outcome.run.exitCode === 0 && outcome.run.stdout.trim() !== ''
            ? 'committed'
            : 'reverted'
        } catch {
          return null
        } finally {
          clearTimeout(timer)
        }
      },
    }
  }

  /** 每会话一份的去向判定缓存(惰性创建,dispose 随会话清理)。 */
  private trackedPathStates(id: string): PathStateTracker {
    let tracker = this.pathStates.get(id)
    if (tracker === undefined) {
      tracker = new PathStateTracker()
      this.pathStates.set(id, tracker)
    }
    return tracker
  }

  /** 惰性解析会话仓库根(缓存;失败 → null)。 */
  private async resolveRoot(sessionId: string): Promise<string | null> {
    let root = this.probeRoots.get(sessionId)
    if (root === undefined) {
      const workspace = await resolveWorkspace(this.deps, sessionId)
      root = workspace.ok ? workspace.root : null
      this.probeRoots.set(sessionId, root)
    }
    return root
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

  /** 去向判定持久化通道:ps-<sessionKey>.jsonl(与 obs 同目录同构)。
   * 判定(git 历史可达性)跨宿主重启依然成立——持久化让"插件更新/宿主
   * 重启"不再触发全量重新收敛(事故复盘 incident-load-hang 的复发根因)。 */
  private pathStatesPersistence(sessionId: string): { read(): Promise<string | null>; write(raw: string): Promise<void> } {
    const file = `ps-${sessionStorageKey(sessionId)}.jsonl`
    return {
      read: async () => {
        const result = await this.storage.read({ file } satisfies GitStorageReadRequest)
        if (!result.ok) return null
        return result.value
      },
      write: async (raw) => {
        const result = await this.storage.write({ file, data: raw } satisfies GitStorageWriteRequest)
        if (!result.ok) throw new Error(`ps write failed: ${result.error.message}`)
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
      snapshot: (id, sig) => this.snapshotForRecords(id, sig),
      presenter: this.presenter,
      mtimes: (snapshot) => this.mtimesFor(snapshot),
      subagentWrites: (id, root) => Promise.resolve(
        collectSubagentWrites(id, this.records.turns(id), this.sessions, root, this.presenter),
      ),
      siblingWrites: (id, root) => Promise.resolve(
        collectSiblingWrites(id, this.sessions, root, this.presenter),
      ),
      probe: (id) => this.probeFor(id),
      pathStates: (id) => this.trackedPathStates(id),
      ensurePathStates: async (id) => {
        // 惰性创建 + 幂等恢复(重启后首次查询载入磁盘判定,不再从头收敛)。
        const tracker = this.trackedPathStates(id)
        if (tracker.restored) return undefined
        const stored = await this.pathStatesPersistence(id).read()
        if (stored !== null) {
          const entries: Array<readonly [string, 'committed' | 'reverted']> = []
          for (const line of stored.split('\n')) {
            if (line === '') continue
            try {
              const parsed = JSON.parse(line) as { p?: unknown; s?: unknown }
              if (typeof parsed.p === 'string' && (parsed.s === 'committed' || parsed.s === 'reverted')) {
                entries.push([parsed.p, parsed.s])
              }
            } catch {
              // 坏行跳过(文件被截断/损坏时不阻断恢复)
            }
          }
          tracker.restore(entries)
        }
        tracker.restored = true
        return undefined
      },
      persistPathStates: async (id) => {
        const tracker = this.pathStates.get(id)
        if (tracker === undefined || !tracker.isDirty) return
        try {
          const raw = tracker.entries()
            .map(([path, state]) => JSON.stringify({ p: path, s: state }))
            .join('\n')
          await this.pathStatesPersistence(id).write(raw)
          tracker.clearDirty()
        } catch {
          // 落盘失败不阻断查询:判定仍在内存缓存,下次有变化时重写。
        }
      },
      finalStateProbe: (id) => this.finalStateProbeFor(id),
      now: () => Date.now(),
    }
    return runTurnRecords(this.records, sources, sessionId, signal).catch((error: unknown) => {
      // 防御:编排层异常(理论不应发生)不得冒泡到 typert——归一为 git-error。
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { code: 'git-error', message: `turn-records pipeline failed: ${message}` } }
    })
  }

  /** snapshot + 随路观测跟踪(端点与 turn-records 共用);成功结果入缓存。 */
  private async snapshotWithTrack(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    const result = await this.endpoints.snapshot(request, signal)
    if (result.ok) {
      this.cacheSnapshot(request.sessionId, result.value)
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

  /**
   * 出厂预设获取:返回 config.defaultSettings(经 migrateSettings 补全)或 null。
   * 客户端在 settings.json 缺失时调用此方法作为"出厂值"——首次安装即用
   * 部署方预设(来自 cordis.patch.yml config.defaultSettings)。
   * null = 部署方未提供预设,客户端回退到代码内 DEFAULT_SETTINGS。
   */
  @Remote('getPreset')
  async getPreset(_request: GitPresetRequest): Promise<GitPresetResult> {
    const raw = this.normalizedConfig.defaultSettings
    if (raw === undefined || typeof raw !== 'object' || raw === null) {
      return { ok: true, value: null }
    }
    const r = raw as Record<string, unknown>
    try {
      return {
        ok: true,
        value: migrateSettings({
          pill: r.pill as Parameters<typeof migrateSettings>[0]['pill'],
          popup: (r.popup as PopupSettings) ?? DEFAULT_SETTINGS.popup,
          diff: r.diff as Parameters<typeof migrateSettings>[0]['diff'],
        }),
      }
    } catch {
      // 格式错误:回退 null,客户端用 DEFAULT_SETTINGS(wire 边界 zod 也会校验)
      return { ok: true, value: null }
    }
  }
}

/** node:fs/promises 中插件数据存储需要的成员切片(结构注入,便于测试)。 */
function pluginDataFs(): PluginDataFs {
  return { readFile, writeFile, mkdir, rename, rm }
}

export default GitStatusService