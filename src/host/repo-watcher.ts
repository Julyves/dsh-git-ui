/**
 * 仓库文件监听注册表（纯业务，零框架依赖）。
 *
 * 设计要点（第二轮调研结论的落地）：
 *   - **双监听面**：工作区面（递归，事件级排除 node_modules 等噪音目录）
 *     与 gitdir 面（`rev-parse --absolute-git-dir` 解析出的真实 .git 目录，
 *     linked worktree 场景下不是 <root>/.git）相互独立、互为冗余——
 *     任一面失败只损失对应感知能力，另一面继续工作。
 *   - **降级阶梯**：fs.watch 的任何失败形态（不支持递归/ENOSPC/EMFILE/
 *     EPERM/目录消失）统一走 close + 停用该面，不抛出、不重试风暴；
 *     两面全失败 = 纯轮询兜底（客户端行为退化为现状，零回归）。
 *   - **防抖饥饿防护**：trailing 防抖 + maxWait 上限——构建工具持续输出
 *     时纯 trailing 会永远等不到静默，maxWait 保证风暴期间每 maxWait
 *     至多 bump 一次版本。
 *   - **版本语义（不等式）**：调用方以 `changedSince(v)` 判定
 *     `version !== v`。宿主服务重启后计数器归零，不等式天然自愈
 *     （客户端拿到一次多余刷新后重新对齐），`>` 语义会永久挂起。
 *   - **引用计数**：同一 root 的多会话共享一份监听；最后一个引用释放
 *     才真正 close，无人观看的仓库不占用内核资源。
 *
 * watcher 工厂与时间行为均可注入（短 debounce/maxWait 实测），测试零真实文件系统。
 */

/** 版本变化订阅者（无参；调用方自行重读 currentVersion）。 */
export type WatchableListener = () => void

/** 一路已建立的底层监听（可关闭）。 */
export interface WatchHandle {
  close(): void
}

/**
 * 底层 watcher 工厂（node:fs.watch 的结构化切片；测试注入假实现）。
 *
 * 返回 undefined = 该路径无法监听（同步失败，如目录不存在/不支持递归）；
 * 异步失败通过 onError 上报（工厂负责把 FSWatcher 的 'error' 事件接到它）。
 */
export type WatchFactory = (
  path: string,
  options: { recursive: boolean },
  onEvent: (relative: string | null) => void,
  onError: (error: unknown) => void,
) => WatchHandle | undefined

/** 一个仓库 root 的监听面（失败后 dead，不再重试）。 */
interface WatchSurface {
  handle: WatchHandle | undefined
  dead: boolean
}

/** 一份按 root 共享的仓库监听（引用计数管理生命周期）。 */
export class RepoWatch {
  private readonly worktree: WatchSurface
  private readonly gitdir: WatchSurface
  private version: number
  private readonly listeners = new Set<WatchableListener>()
  private refCount = 0
  private disposed = false
  /** 构造完成标记:两面尚未建齐前不做死亡唤醒(healthy 判定需双面就绪)。 */
  private constructed = false
  /** trailing 防抖计时器与风暴窗口起点（maxWait 饥饿防护）。 */
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private burstStartAt: number | undefined
  /** 引用触零后的延迟释放计时器(心跳拆建防护,见 release)。 */
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    readonly root: string,
    gitDir: string | null,
    private readonly factory: WatchFactory,
    private readonly excludes: ReadonlySet<string>,
    private readonly debounceMs: number,
    private readonly maxWaitMs: number,
    /** 初始版本(注册表持久计数;实例销毁重建不归零——见 Registry)。 */
    initialVersion = 0,
    /** 版本回写(注册表持久化;缺省 = 单实例语义)。 */
    private readonly onVersion?: (root: string, version: number) => void,
    /** 引用触零后延迟释放的宽限时长(ms);缺省 0 = 立即释放。 */
    private readonly idleReleaseMs = 0,
  ) {
    this.version = initialVersion
    this.worktree = this.startSurface(root)
    this.gitdir = gitDir === null ? { handle: undefined, dead: true } : this.startSurface(gitDir)
    // 建齐后补一次死亡判定:构造期内同步失败(如 gitdir 解析 null 之外的
    // 同步异常)此时才可能构成双面全挂。
    this.constructed = true
    this.notifyIfDead()
  }

  /** 当前版本号（每次防抖确认的变更 +1；服务重启后从 0 重新计数）。 */
  currentVersion(): number {
    return this.version
  }

  /** 不等式判定：版本不同 = 有变化（重启归零后自愈对齐）。 */
  changedSince(known: number): boolean {
    return this.version !== known
  }

  /** 订阅版本变化；返回取消订阅函数。 */
  onChange(listener: WatchableListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 引用 +1;取消挂起的延迟释放(心跳间隙内直接复用)。 */
  acquire(): void {
    if (this.disposed) return
    this.refCount += 1
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  /**
   * 引用 -1;触零后**延迟释放**(复审 R5):客户端「驻留结束→立即重挂」
   * 的间隙仅毫秒级,但单会话仓库每心跳(25s)都会触零一次——立即销毁
   * 意味着每心跳全量重建(rev-parse + 双面递归注册,大仓成本可观)。
   * 宽限期内无新引用才真正关闭;附带效应:单面失败约每宽限期隐式重试
   * 一次(自愈),与「失败不重试」的瞬时语义略有出入,属可接受的周期
   * 性自愈。
   */
  release(): void {
    // 负计数防护(复审 P2-6):契约一 acquire 一 release,双 release 属
    // 调用方 bug——在此截断,防止把存活实例的宽限计时误触成销毁。
    if (this.refCount <= 0 || this.disposed) return
    this.refCount -= 1
    if (this.refCount > 0 || this.disposed) return
    if (this.idleReleaseMs <= 0) {
      this.dispose()
      return
    }
    if (this.idleTimer !== undefined) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.refCount <= 0) this.dispose()
    }, this.idleReleaseMs)
    // 宽限计时器不得独自维持宿主事件循环存活。
    ;(this.idleTimer as { unref?: () => void }).unref?.()
  }

  /** 强制关闭（服务卸载/全量清理）；幂等。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    this.clearDebounce()
    this.worktree.handle?.close()
    this.gitdir.handle?.close()
    this.listeners.clear()
  }

  /** 是否仍有任一监听面存活（诊断/测试用）。 */
  get healthy(): boolean {
    return !this.worktree.dead || !this.gitdir.dead
  }

  /** 是否已整体关闭（注册表据此丢弃缓存条目）。 */
  get isDisposed(): boolean {
    return this.disposed
  }

  /**
   * 建立一个监听面：同步抛错/返回 undefined → dead；异步 error → 关闭并
   * 标记 dead（降级，不重试）。死亡后若构成双面全挂,唤醒全部订阅者——
   * 驻留查询得以即时降级结算,而非等满心跳(复审 P1-4)。
   */
  private startSurface(path: string): WatchSurface {
    const surface: WatchSurface = { handle: undefined, dead: false }
    try {
      surface.handle = this.factory(
        path,
        { recursive: true },
        (relative) => { this.onFsEvent(relative) },
        () => {
          surface.dead = true
          surface.handle?.close()
          surface.handle = undefined
          this.notifyIfDead()
        },
      )
      if (surface.handle === undefined) {
        surface.dead = true
        this.notifyIfDead()
      }
    } catch {
      surface.handle = undefined
      surface.dead = true
      this.notifyIfDead()
    }
    return surface
  }

  /** 双面全挂时唤醒全部订阅者(无版本 bump;仅死亡信号)。 */
  private notifyIfDead(): void {
    if (!this.constructed || this.disposed || this.healthy) return
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // 订阅者异常隔离(与 bump 同纪律)。
      }
    }
  }

  /**
   * 一条文件系统事件：事件级排除（噪音目录）+ trailing/maxWait 防抖。
   *
   * `relative` 为相对被监听路径的段串（fs.watch filename），null = 无法
   * 判定来源（保守视为有效变更）。
   */
  private onFsEvent(relative: string | null): void {
    if (this.disposed) return
    if (relative !== null && this.isExcluded(relative)) return
    const now = Date.now()
    if (this.burstStartAt === undefined) this.burstStartAt = now
    // 已超 maxWait：立即 bump 并重开风暴窗口（饥饿防护的核心分支）。
    if (now - this.burstStartAt >= this.maxWaitMs) {
      this.bump()
      return
    }
    // trailing 防抖：最后一次事件后 debounceMs 静默才 bump。
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => { this.bump() }, this.debounceMs)
  }

  /** 相对路径首段命中排除集（node_modules 等）。
   * 个别平台/版本会对 recursive watch 上报绝对路径——归一化前导分隔符
   * 后取首段(Windows 盘符形态不识别,保守放行,至多多一次防抖合并)。 */
  private isExcluded(relative: string): boolean {
    const first = relative.replace(/^[\\/]+/, '').split(/[\\/]/)[0] ?? ''
    return first !== '' && this.excludes.has(first)
  }

  /** 版本 bump：清窗、清计时器、回写注册表、通知全部订阅者。 */
  private bump(): void {
    this.clearDebounce()
    this.version += 1
    this.onVersion?.(this.root, this.version)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // 单个订阅者异常不得影响其他订阅者（防御：正常不应发生）。
      }
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    this.burstStartAt = undefined
  }
}

/**
 * 仓库监听注册表：按 root 复用 RepoWatch；gitdir 解析随 root 惰性进行
 * （仅首次建监听时调用一次，失败 = 工作区单面监听）。
 *
 * **版本计数持久于注册表**（root → version）：refCount 归零释放的是内核
 * 监听资源，**不是**变更代数。客户端 watch 循环在「驻留结束 → 立即重挂」
 * 的毫秒级间隙里会让 refCount 触零——若版本随实例销毁归零，每次重挂都
 * 会假报 changed（事件驱动退化为每心跳一次全量快照）。重建的实例从持久
 * 计数继承，代数永不闪断。
 *
 * 生命周期约定：`acquire` 返回共享实例（引用 +1）；调用方在驻留调用
 * 结束/中止时必须 `release`。`disposeAll` 供服务卸载时整体回收。
 */
export class RepoWatcherRegistry {
  private readonly watches = new Map<string, RepoWatch>()
  /** root → 最近一次 bump 的版本(实例销毁后仍保留;重建时继承)。 */
  private readonly versions = new Map<string, number>()
  private disposed = false

  constructor(
    private readonly factory: WatchFactory,
    private readonly options: {
      readonly debounceMs: number
      readonly maxWaitMs: number
      readonly excludes: readonly string[]
      /** 引用触零后的释放宽限(ms);0 = 立即。生产取一个心跳量级。 */
      readonly idleReleaseMs: number
    },
    /** gitdir 解析器（宿主注入：rev-parse --absolute-git-dir，可自带缓存）。 */
    private readonly resolveGitDir: (root: string) => Promise<string | null>,
  ) {}

  /** 取（或建）一份 root 监听并引用 +1；已释放的缓存实例丢弃重建。 */
  async acquire(root: string): Promise<RepoWatch> {
    let watch = this.watches.get(root)
    if (watch !== undefined && watch.isDisposed) {
      this.watches.delete(root)
      watch = undefined
    }
    if (watch === undefined) {
      if (this.disposed) return this.emptyWatch(root)
      const gitDir = await this.resolveGitDir(root)
      // await 间隙的二次复查(复审 R2/R3):①并发 acquire 同 root 已完成
      // 建例——共享同一实例,防双份内核 watcher 与版本表双写;②disposeAll
      // 恰落在解析窗口内——尊重回收契约,不再建活监听。
      if (this.disposed) return this.emptyWatch(root)
      watch = this.watches.get(root)
      if (watch !== undefined) {
        watch.acquire()
        return watch
      }
      watch = new RepoWatch(
        root,
        gitDir,
        this.factory,
        new Set(this.options.excludes),
        this.options.debounceMs,
        this.options.maxWaitMs,
        this.versions.get(root) ?? 0,
        (at, version) => { this.versions.set(at, version) },
        this.options.idleReleaseMs,
      )
      this.watches.set(root, watch)
    }
    watch.acquire()
    return watch
  }

  /**
   * 已回收后的一次性空实例(全 dead、立即释放)。**版本继承持久计数**
   * (复审 R3):恒 0 会令卸载窗口内在途的 watch 每次假报 changed——与
   * versionOf 的持久语义不一致,形成与 R1 同源的刷新风暴。
   */
  private emptyWatch(root: string): RepoWatch {
    const empty = new RepoWatch(
      root, null, () => undefined, new Set(), 0, 0,
      this.versions.get(root) ?? 0,
      undefined,
      0,
    )
    // 引用配对:先 acquire 再 dispose——调用方的 release 落在平衡账上
    // (0→1→disposed),而非把 refCount 打成 -1。
    empty.acquire()
    empty.dispose()
    return empty
  }

  /** 仅查询当前版本（不引用、不建监听）：活实例优先，其次持久计数。 */
  versionOf(root: string): number {
    return this.watches.get(root)?.currentVersion() ?? this.versions.get(root) ?? 0
  }

  /** 服务卸载：整体回收（已驻留的调用由调用方自行结算）。 */
  disposeAll(): void {
    this.disposed = true
    for (const watch of this.watches.values()) watch.dispose()
    this.watches.clear()
    // versions 保留:disposeAll 后同进程若再建(测试形态),代数仍连续。
  }
}
