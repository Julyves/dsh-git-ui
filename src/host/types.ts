/**
 * dsh-git-ui host data model. This file is the authoritative type source;
 * the client half mirrors it with zod schemas (see src/client/remote.ts) and
 * `tests/remote.spec.ts` keeps the two in sync.
 */
import type { GitUISettings } from '../contracts/settings.ts'

/** Wire request: the browser never sends paths — only the session identity. */
export interface GitSnapshotRequest {
  readonly sessionId: string
}

/** Discriminated outcome of one snapshot attempt. */
export type GitSnapshotResult =
  | { readonly ok: true; readonly value: GitSnapshot }
  | { readonly ok: false; readonly error: GitSnapshotFailure }

export type GitSnapshotFailure =
  | { readonly code: 'session-not-found'; readonly sessionId: string }
  | { readonly code: 'cwd-unavailable'; readonly sessionId: string }
  | { readonly code: 'path-not-found'; readonly path: string }
  | { readonly code: 'git-unavailable'; readonly detail: string }
  | { readonly code: 'timeout' }
  | { readonly code: 'not-a-git-repo' }

/** Immutable frozen snapshot of one repository's status at `checkedAt`. */
export interface GitSnapshot {
  /** Realpath of the repository root (work tree top). */
  readonly root: string
  /** Current branch name; null when detached. */
  readonly branch: string | null
  /** Short HEAD hash; null when the repository has no commits (unborn). */
  readonly head: string | null
  /** True when the repository has no commits yet. */
  readonly unborn: boolean
  /** staged + modified + untracked > 0. */
  readonly dirty: boolean
  readonly staged: number
  readonly modified: number
  readonly untracked: number
  readonly ahead: number
  readonly behind: number
  readonly lastCommit: GitCommit | null
  readonly recentCommits: readonly GitCommit[]
  readonly changes: readonly GitChange[]
  /** True when `changes` was capped at maxChanges or status output overflowed. */
  readonly truncated: boolean
  /** Polling interval the client should use after this snapshot (0 = off). */
  readonly refreshIntervalMs: number
  /** Epoch millis of the snapshot. */
  readonly checkedAt: number
}

export interface GitCommit {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly author: string
  readonly dateIso: string
}

/**
 * 带父引用的提交（图渲染用）。
 * `parents` 为完整 SHA（线上格式以空格分隔）；根提交为空数组。
 * `refs` 为 `%D` 装饰（分支 / 远程 / 标签）。
 */
export interface GraphCommit extends GitCommit {
  readonly parents: readonly string[]
  readonly refs: readonly GitRef[]
}

/** 提交上挂载的一个 ref 装饰（分支 / 远程 / 标签）。 */
export interface GitRef {
  readonly kind: 'branch' | 'remote' | 'tag'
  readonly name: string
  /** `HEAD -> name` 的当前分支为 true。 */
  readonly head: boolean
}

/**
 * 一条变更文件条目。混合状态（porcelain XY 双列均非空，如 MM/AM）会被
 * 拆为两条：`staged: true` 一侧（状态取 X 列）与 `staged: false` 一侧
 * （状态取 Y 列），UI 据此分列「已暂存更改 / 更改」两组（IDEA 式）。
 * 真实冲突（UU/AA/DD 等）保持单条 `conflicted`。
 */
export interface GitChange {
  readonly path: string
  readonly status: GitChangeStatus
  readonly staged: boolean
  /**
   * 目录条目（git status 对未跟踪目录输出 `dir/`，host 解析时权威标记）。
   * 展示层必须以此字段判断目录而非字符串派生——任何路径规范化剥离尾斜杠
   * 都不会丢失目录性（`.agent/` 曾被当文件展示的根因防护）。
   */
  readonly isDirectory: boolean
}

export type GitChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

/**
 * One git management operation addressed by the `run` endpoint. Paths are
 * always repository-relative (as listed in a snapshot's `changes`), never
 * absolute — the host validates them against the work tree.
 */
export type GitAction =
  | { readonly kind: 'stage'; readonly paths: readonly string[] }
  | { readonly kind: 'stage-all' }
  | { readonly kind: 'unstage'; readonly paths: readonly string[] }
  | { readonly kind: 'unstage-all' }
  | { readonly kind: 'discard'; readonly paths: readonly string[] }
  | { readonly kind: 'discard-all' }
  | {
    readonly kind: 'commit'
    readonly message: string
    /** Commit only these paths (git commit -- <paths> semantics); absent or
     * empty commits everything already staged. */
    readonly paths?: readonly string[]
  }
  | { readonly kind: 'branch-create'; readonly name: string; readonly from?: string }
  | { readonly kind: 'branch-checkout'; readonly name: string }
  | { readonly kind: 'branch-delete'; readonly name: string; readonly force?: boolean }
  | { readonly kind: 'fetch' }

export type GitOperationErrorCode =
  | 'session-not-found'
  | 'cwd-unavailable'
  | 'path-not-found'
  | 'not-a-git-repo'
  | 'git-unavailable'
  | 'invalid-path'
  | 'invalid-name'
  | 'git-error'
  | 'timeout'
  /** 切分支被工作区未提交变更阻止（git: "would be overwritten by checkout"）。
   * host 归一化为业务错误：client 用友好文案 +「处理变更」引导，不再直接
   * 抛原始多行 git stderr。原始信息保留在 message。 */
  | 'local-changes-block'

export type GitActionResult =
  | { readonly ok: true; readonly snapshot: GitSnapshot; readonly output?: string }
  | { readonly ok: false; readonly error: { readonly code: GitOperationErrorCode; readonly message?: string } }

/** Wire request of the `run` endpoint. */
export interface GitActionRequest {
  readonly sessionId: string
  readonly action: GitAction
}

// ── Query endpoint (read-only inspections: history / diff / show / branches) ──

/** 一条只读查询，对应 `gitInfo/query` 端点。 */
export type GitQuery =
  | {
    readonly kind: 'history'
    readonly limit: number
    readonly skip: number
    /** 可选 ref 过滤（分支/远程/标签）；缺省为 --all 全分支。 */
    readonly ref?: string
    /** 文本搜索：7+ 位十六进制视为哈希前缀跳转；否则提交信息正则搜索（-i -E）。 */
    readonly search?: string
    /** 作者过滤（--author）。 */
    readonly author?: string
    /** 日期下限（--since，如 '7 days ago'）。 */
    readonly since?: string
  }
  | { readonly kind: 'diff'; readonly path: string; readonly base: 'worktree' | 'staged' }
  | { readonly kind: 'show'; readonly ref: string }
  | { readonly kind: 'branches' }
  | { readonly kind: 'tags' }
  | { readonly kind: 'authors' }
  | { readonly kind: 'turn-records' }

/** 提交变更文件行(`--name-status` 源:状态 + 路径,不再携带 +/- 行数)。 */
export interface GitFileStat {
  readonly path: string
  readonly status: GitChangeStatus
}

// ── Turn 工作记录(turn-records 查询) ──────────────────────────────────────

/** 记录条目状态:仍变更 / 已提交 / 已还原(权威判定)/ 已离开待定。 */
export type WorkEntryState = 'dirty' | 'committed' | 'reverted' | 'gone'

/** 归因置信度:authoritative = 平台自证写意图(diff 卡/写类卡/result meta);
 * inferred = 启发式或观测推断(bash 静态目标/args 兜底/时间窗归因)。
 * 信任类功能的戒律:宁可显式的不完美,不要隐式的不可靠——推断必须可见。 */
export type WorkAttribution = 'authoritative' | 'inferred'

/** 一条对外展示的工作记录条目。 */
export interface WorkEntry {
  readonly path: string
  readonly status: GitChangeStatus
  readonly state: WorkEntryState
  /** 首见/写入时刻(Unix ms;internal 取自日志,external 取自观测)。 */
  readonly firstSeenAt: number
  /** 已提交条目的提交哈希(提交跳转深链);null = 无/未观测到。 */
  readonly commitHash: string | null
  /** 归因置信度(UI 推断标记 + 人工纠错入口的依据)。 */
  readonly attribution: WorkAttribution
  /** 本轮新增(L4 指纹派生:不在上一 turn 边界指纹中;缺省 = 未知)。 */
  readonly fresh?: boolean
}

/** 一个 turn 的对外工作记录。 */
export interface TurnWorkRecord {
  readonly turn: number
  readonly startAt: number
  /** 窗口截止;null = 进行中(截止 = 客户端渲染时的 now)。 */
  readonly endAt: number | null
  /** 是否含工具调用(空 turn 折叠展示用)。 */
  readonly hasWork: boolean
  /** 驱动该 turn 的用户指令摘要(任务叙事;null = 未捕获)。 */
  readonly narrative: string | null
  /** 本会话 agent(含 subagent 委托)写入。 */
  readonly internal: readonly WorkEntry[]
  /**
   * 其他 dsh 会话(同工作区)AI 写入——既非本会话也非人工。
   * 归因轴对齐用户心智:「AI 改的」与「我改的」不再混在同一个「外部」桶。
   */
  readonly sibling: readonly WorkEntry[]
  /** 外部(人工:IDE / 命令行 / 未识别来源)。 */
  readonly external: readonly WorkEntry[]
}

/** One branch row from `git branch --format`. Local branches may carry
 * ahead/behind counts relative to their upstream (from `%(upstream:track)`). */
export interface GitBranch {
  readonly name: string
  readonly shortHash: string | null
  /** 本地分支领先上游的提交数（仅本地有上游时存在）。 */
  readonly ahead?: number
  /** 本地分支落后上游的提交数（仅本地有上游时存在）。 */
  readonly behind?: number
}

export type GitQueryResult =
  // total = -1 表示「未知」(rev-list 探测失败):client 按尚未到终点的
  // 续载语义处理,不得冻结无限滚动。
  | { readonly kind: 'history'; readonly commits: readonly GraphCommit[]; readonly total: number }
  | { readonly kind: 'diff'; readonly path: string; readonly text: string }
  | {
    readonly kind: 'show'
    readonly ref: string
    readonly commit: GitCommit | null
    /** 提交完整正文（不含 subject 行）；IDEA 式右栏展示用。 */
    readonly body: string
    readonly stats: readonly GitFileStat[]
  }
  | { readonly kind: 'branches'; readonly current: string | null; readonly defaultBranch: string | null; readonly local: readonly GitBranch[]; readonly remote: readonly GitBranch[] }
  | { readonly kind: 'tags'; readonly tags: readonly GitBranch[] }
  | { readonly kind: 'authors'; readonly authors: readonly string[] }
  | { readonly kind: 'turn-records'; readonly turns: readonly TurnWorkRecord[] }

export type GitQueryResponse =
  | { readonly ok: true; readonly value: GitQueryResult }
  | { readonly ok: false; readonly error: { readonly code: GitOperationErrorCode; readonly message?: string } }

/** Wire request of the `query` endpoint. */
export interface GitQueryRequest {
  readonly sessionId: string
  readonly query: GitQuery
}

// ── Plugin data storage endpoint ────────────────────────────────────────────

/**
 * 插件数据目录的存储请求。
 * 浏览器永不发送路径——只发白名单校验通过的单文件名
 * （`plugin-data/dsh-git-ui/<file>` 之下，禁止目录穿越）。
 */
export interface GitStorageReadRequest {
  readonly file: string
}

/** 读取结果：文件不存在 → value: null（非错误）；IO 失败 → io-error。 */
export type GitStorageReadResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: { readonly code: 'invalid-file' | 'io-error'; readonly message: string } }

/** 写入请求：data 为原始文本（原子写：临时文件 + rename）。 */
export interface GitStorageWriteRequest {
  readonly file: string
  readonly data: string
}

/** 写入结果：成功仅 ok（无负载）；失败同上。 */
export type GitStorageWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: 'invalid-file' | 'io-error'; readonly message: string } }

// ── Preset (出厂预设获取) ──────────────────────────────────────────────────

/** 预设请求(无参数——预设是插件级 config,不按会话区分)。 */
export interface GitPresetRequest {}

/** 预设结果:value = host config.defaultSettings 经迁移补全后的完整设置;
 * null = 部署方未提供预设,客户端回退到代码内 DEFAULT_SETTINGS。 */
export type GitPresetResult = { readonly ok: true; readonly value: GitUISettings | null }
