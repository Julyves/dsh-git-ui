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
import { watch as fsWatch } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, resolveWorkspace, runCommand, type GitStatusConfig, type SnapshotDeps } from './core.ts'
import { createPluginDataStore, resolvePluginDataRoot, type PluginDataFs } from './plugin-data.ts'
import { createHostEndpoints, type HostEndpoints } from '../contracts/host-endpoints.ts'
import { migrateSettings, DEFAULT_SETTINGS, type PopupSettings } from '../contracts/settings.ts'
import { RecordStore, OBS_FLUSH_DEBOUNCE_MS, type CommitProbe } from './record-store.ts'
import { runTurnRecords, type TurnRecordSources } from './turn-records.ts'
import { parseCommitPathsOutput, type CommitPath } from './parser.ts'
import { PathStateTracker, type PathStateProbe } from './path-state.ts'
import { RepoWatcherRegistry, type WatchFactory } from './repo-watcher.ts'
import { sliceEvents, type SessionLike } from '../adapters/dsh/session-log.ts'
import { createToolPresenter, type ToolRegistryLike } from '../adapters/dsh/tools-presenter.ts'
import { collectSubagentWrites, type SessionsLike as SubagentSessionsLike } from '../adapters/dsh/subagent-adapter.ts'
import { collectSiblingWrites } from '../adapters/dsh/sibling-adapter.ts'
import { persistenceChannel } from './persistence-channels.ts'
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

/** watch 长轮询的等待上限(ms):客户端可请求更短,宿主 clamp 到此值——
 * 驻留调用必须有界,防病态挂起。 */
const WATCH_WAIT_CAP_MS = 60_000

/** 引用触零后的释放宽限(ms):覆盖客户端「驻留结束→重挂」的间隙与
 * 单会话心跳周期,避免每 25s 全量重建内核 watcher(复审 R5)。 */
const WATCH_IDLE_RELEASE_MS = 60_000

/**
 * 真实 watcher 工厂(node:fs.watch → RepoWatcherRegistry 的结构化切片)。
 *
 * - `persistent: false`:watcher 不得独自维持宿主事件循环存活。
 * - filename 可能是 Buffer(编码不确定)——统一 String 化;null(无法判定
 *   来源)保守视为有效变更。
 * - 异步 'error'(ENOSPC/EMFILE/EPERM/目录消失)交由 RepoWatch 降级。
 */
const fsWatchFactory: WatchFactory = (path, options, onEvent, onError) => {
  const watcher = fsWatch(path, { recursive: options.recursive, persistent: false }, (_eventType, filename) => {
    onEvent(filename === null ? null : String(filename))
  })
  watcher.on('error', (error) => { onError(error) })
  return {
    close: () => { watcher.close() },
  }
}

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
  /** 仓库文件监听注册表(事件驱动刷新;按 root 共享 + 引用计数)。 */
  private readonly watchers: RepoWatcherRegistry

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitInfo')
    this.normalizedConfig = normalizeConfig(config)
    // registry 先建(构造零副作用,不监听任何路径);resolveGitDir 运行时
    // 才触达 this.deps,规避 registry↔deps 构造环。
    this.watchers = new RepoWatcherRegistry(
      fsWatchFactory,
      {
        debounceMs: this.normalizedConfig.watchDebounceMs,
        maxWaitMs: this.normalizedConfig.watchMaxWaitMs,
        excludes: this.normalizedConfig.watchExcludes,
        idleReleaseMs: WATCH_IDLE_RELEASE_MS,
      },
      (root) => this.resolveGitDir(root),
    )
    const deps = this.buildDeps(ctx, this.normalizedConfig)
    // 快照随路携带 watchVersion(watch 循环的协调锚点);纯业务测试缺省 0。
    this.deps = { ...deps, watchVersionOf: (root) => this.watchers.versionOf(root) }
    this.sessions = ctx.get<SessionsService>('sessions')
    this.storage = createPluginDataStore(pluginDataFs(), {
      root: resolvePluginDataRoot(this.normalizedConfig.dshHome),
    })
    // 平台写意图解析面:tools 服务为可选(缺失 → args 目录兜底,见 write-paths.ts)。
    this.presenter = createToolPresenter(ctx.get<ToolRegistryLike>('tools'))
    this.records = new RecordStore(
      (sessionId) => this.observationPersistence(sessionId),
      OBS_FLUSH_DEBOUNCE_MS,
      (sessionId) => this.narrativePersistence(sessionId),
      (sessionId) => this.fingerprintPersistence(sessionId),
    )
    this.endpoints = createHostEndpoints(this.deps, this.normalizedConfig, {
      run: (sessionId, signal) => this.runTurnRecords(sessionId, signal),
    }, {
      run: (sessionId, version, waitMs, signal) => this.runWatchQuery(sessionId, version, waitMs, signal),
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
      // 事件监听整体回收:驻留中的 watch 调用由各自的超时/中止自然结算
      // (ctx 已亡,结果无人接收,无害)。
      this.watchers.disposeAll()
    })
  }

  // ── 观测跟踪(snapshot/run 成功后随路更新) ────────────────────────────────

  private async track(sessionId: string, snapshot: GitSnapshot): Promise<void> {
    this.records.observe(sessionId, snapshot.changes, snapshot.checkedAt, snapshot.truncated)
    // L4:turn 边界指纹随每次快照幂等捕获(最新 turn 首次观测到的边界态)。
    this.records.captureFingerprint(sessionId, snapshot.changes, snapshot.checkedAt)
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

  /** HEAD 前移 → 路径→提交映射(git log --format=%H --name-status -z;失败返回空)。
   * 同一条 git 命令既判 committed 又携带哈希——提交跳转零额外命令。 */
  private async commitsBetween(sessionId: string, from: string, to: string): Promise<readonly CommitPath[]> {
    const workspace = await resolveWorkspace(this.deps, sessionId)
    if (!workspace.ok) return []
    const outcome = await runCommand(
      this.deps.run,
      ['git', 'log', '--format=%H', '--name-status', '-z', `${from}..${to}`],
      workspace.root,
      'log commits',
    )
    if ('failure' in outcome) return []
    if (outcome.run.timedOut || outcome.run.exitCode !== 0) return []
    return parseCommitPathsOutput(outcome.run.stdout)
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
  private observationPersistence(sessionId: string) {
    return persistenceChannel(this.storage, 'obs', 'obs', sessionId)
  }

  /** 叙事持久化通道:narr-<sessionKey>.jsonl(compaction 折叠旧 user/message
   * 事件后,任务叙事仍可从磁盘恢复;新捕获值优先,磁盘只补 null 槽位)。 */
  private narrativePersistence(sessionId: string) {
    return persistenceChannel(this.storage, 'narr', 'narr', sessionId)
  }

  /** 指纹持久化通道:fp-<sessionKey>.jsonl(turn 边界变更路径集,检查点基础)。 */
  private fingerprintPersistence(sessionId: string) {
    return persistenceChannel(this.storage, 'fp', 'fp', sessionId)
  }

  /** 去向判定持久化通道:ps-<sessionKey>.jsonl(与 obs 同目录同构)。
   * 判定(git 历史可达性)跨宿主重启依然成立——持久化让"插件更新/宿主
   * 重启"不再触发全量重新收敛(事故复盘 incident-load-hang 的复发根因)。 */
  private pathStatesPersistence(sessionId: string) {
    return persistenceChannel(this.storage, 'ps', 'ps', sessionId)
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
      siblingWrites: (id, root) => collectSiblingWrites(id, this.sessions, root, this.presenter, {
        // realpath 归一:兄弟 cwd(启动原始路径)与本工作区根(realpath)的
        // 符号链接形态差异由它抹平(P3-6);失败由适配器保守回退。
        realpath: (path) => realpath(path),
      }),
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

  // ── watch 查询(事件驱动刷新的宿主半) ────────────────────────────────────

  /**
   * gitdir 解析(promise 缓存):`rev-parse --absolute-git-dir`——linked
   * worktree 场景下 `<root>/.git` 是文件,真实 HEAD/index/refs 在主仓
   * gitdir 下;直接监听 `<root>/.git` 会漏掉全部 git 状态变化。
   * promise 级去重(并发 acquire 只 spawn 一次);仅缓存**成功**结果——
   * 瞬时失败在下一次实例重建时自愈重试(复审 P2-7);失败 → null(单面)。
   */
  private readonly gitDirPromises = new Map<string, Promise<string | null>>()
  private resolveGitDir(root: string): Promise<string | null> {
    let pending = this.gitDirPromises.get(root)
    if (pending === undefined) {
      pending = runCommand(
        this.deps.run,
        ['git', 'rev-parse', '--absolute-git-dir'],
        root,
        'rev-parse gitdir',
      ).then((outcome) => {
        const value = 'run' in outcome && !outcome.run.timedOut && outcome.run.exitCode === 0
          && outcome.run.stdout.trim() !== ''
          ? outcome.run.stdout.trim()
          : null
        if (value === null) {
          // 瞬时失败不缓存(复审增量 P2-b):删除条目,下次实例重建时
          // 重新解析——gitdir 单面降级可自愈,而非进程级永久。
          this.gitDirPromises.delete(root)
        }
        return value
      })
      this.gitDirPromises.set(root, pending)
    }
    return pending
  }

  /**
   * watch 长轮询编排:版本不一致立即返回(不等式——重启归零自愈);一致时
   * 挂起至 版本变化 / waitMs(clamp 上限 60s) / 调用方中止 任一先至。
   *
   * - watcher 关闭 / root 不可解析 / **双监听面全挂** → git-error:客户端
   *   功能探测(连续失败计数)后终态降级为纯轮询——两面全挂时版本永不
   *   bump,若仍应答 changed:false 会令客户端误判健康、把兜底轮询拉长
   *   4×,反而劣于纯轮询现状(降级路径回归,复审 M2)。
   * - 驻留期间持有 root 引用(release 于 finally);客户端卸载会话 → RPC
   *   取消槽 abort → 即时释放,不占内核资源。
   * - 超时/中止返回 changed:false(客户端原样重挂;中止时结果已无人收)。
   * - root 经 probeRoots 会话级缓存解析——与 turn-records 探测同源;
   *   会话 cwd 变化属既有边角(快照路径新鲜解析,watch 锚定旧 root)。
   */
  private async runWatchQuery(sessionId: string, version: number, waitMs: number, signal?: AbortSignal): Promise<GitQueryResponse> {
    if (!this.normalizedConfig.watchEnabled) {
      return { ok: false, error: { code: 'git-error', message: 'watch disabled' } }
    }
    if (signal?.aborted) {
      // 预中止短路:addEventListener 不重放已发生的 abort,不短路会让
      // 已离场的调用驻留到 waitMs 自然超时(有界但无谓占用引用)。
      return { ok: true, value: { kind: 'watch', changed: false, version } }
    }
    // root 与快照同源(复审 P1-3):优先复用最近一次真实快照的 root——
    // 客户端锚点正来自该快照,锚点与被监听 root 永远同一计数器空间。
    // 若走 probeRoots(陈旧缓存),cwd 切换后 watch 锚定旧 root,不同
    // 计数器永不相等 → changed:true 永续循环。无缓存(冷会话)才惰性解析。
    const root = this.snapshotCache.get(sessionId)?.root ?? await this.resolveRoot(sessionId)
    if (root === null) {
      return { ok: false, error: { code: 'git-error', message: 'watch unavailable: no repository root' } }
    }
    const watch = await this.watchers.acquire(root)
    if (!watch.healthy) {
      // 双面全挂(EMFILE/ENOSPC/不支持递归):版本永不 bump,如实上报
      // 错误驱动客户端降级,而不是假装健康(恒 changed:false)。
      watch.release()
      return { ok: false, error: { code: 'git-error', message: 'watch degraded: no live watch surface' } }
    }
    // 非有限 waitMs(畸形直连帧;JSON wire 本身不可达)按 0 处理——立即
    // 判定结算,不走 setTimeout(NaN) 的隐式立即行为。
    const wait = Number.isFinite(waitMs) ? Math.min(Math.max(waitMs, 0), WATCH_WAIT_CAP_MS) : 0
    const finish = (changed: boolean): GitQueryResponse =>
      ({ ok: true, value: { kind: 'watch', changed, version: watch.currentVersion() } })
    try {
      // 立即判定:不等式语义同时覆盖「快照与挂起之间的事件窗」与「宿主
      // 重启计数归零」两种错位。
      if (watch.changedSince(version)) return finish(true)
      if (wait === 0) return finish(false)
      return await new Promise<GitQueryResponse>((resolve) => {
        let settled = false
        const settle = (response: GitQueryResponse): void => {
          if (settled) return
          settled = true
          off()
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(response)
        }
        const onAbort = (): void => { settle(finish(false)) }
        const timer = setTimeout(() => { settle(finish(false)) }, wait)
        // 驻留计时器不得独自维持宿主事件循环存活(ctx dispose 后在途
        // 调用至多等到自然超时,不阻塞进程退出;复审 R7)。
        ;(timer as { unref?: () => void }).unref?.()
        // 先订阅后复查(复审 P2-3):闭合「即时判定与订阅注册」之间的
        // 微任务间隙——间隙内落地的变更由复查补上,此后由订阅接管。
        const off = watch.onChange(() => {
          // 唤醒后复核健康(复审 P1-4):驻留中途双面全挂的死亡唤醒 →
          // 如实报错驱动客户端即时降级;变更唤醒 → changed:true。
          if (!watch.healthy) {
            settle({ ok: false, error: { code: 'git-error', message: 'watch degraded: no live watch surface' } })
          } else {
            settle(finish(true))
          }
        })
        if (watch.changedSince(version)) settle(finish(true))
        // 订阅后复查中止(复审增量建议):abort 落在入口短路之后的 await
        // 间隙时不会被重放,在此兜底即时结算。
        if (signal?.aborted) settle(finish(false))
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    } finally {
      watch.release()
    }
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
          popupOrder: r.popupOrder as readonly string[] | undefined,
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