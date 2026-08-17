/**
 * dsh-git-ui host data model. This file is the authoritative type source;
 * the client half mirrors it with zod schemas (see src/client/remote.ts) and
 * `tests/remote.spec.ts` keeps the two in sync.
 */

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

export interface GitChange {
  readonly path: string
  readonly status: GitChangeStatus
  readonly staged: boolean
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

export type GitOperationErrorCode =
  | 'session-not-found'
  | 'cwd-unavailable'
  | 'path-not-found'
  | 'not-a-git-repo'
  | 'invalid-path'
  | 'invalid-name'
  | 'git-error'
  | 'timeout'

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
  }
  | { readonly kind: 'diff'; readonly path: string; readonly base: 'worktree' | 'staged' | 'head' }
  | { readonly kind: 'diff-commit'; readonly path: string; readonly ref: string }
  | { readonly kind: 'show'; readonly ref: string }
  | { readonly kind: 'branches' }
  | { readonly kind: 'tags' }

/** One changed-file stat row from `git show --stat`. */
export interface GitFileStat {
  readonly path: string
  readonly added: number
  readonly deleted: number
}

/** One branch row from `git branch --format`. */
export interface GitBranch {
  readonly name: string
  readonly shortHash: string | null
}

export type GitQueryResult =
  | { readonly kind: 'history'; readonly commits: readonly GraphCommit[]; readonly total: number }
  | { readonly kind: 'diff'; readonly path: string; readonly text: string }
  | { readonly kind: 'diff-commit'; readonly path: string; readonly ref: string; readonly text: string }
  | {
    readonly kind: 'show'
    readonly ref: string
    readonly commit: GitCommit | null
    /** 提交完整正文（不含 subject 行）；IDEA 式右栏展示用。 */
    readonly body: string
    readonly stats: readonly GitFileStat[]
  }
  | { readonly kind: 'branches'; readonly current: string | null; readonly local: readonly GitBranch[]; readonly remote: readonly GitBranch[] }
  | { readonly kind: 'tags'; readonly tags: readonly GitBranch[] }

export type GitQueryResponse =
  | { readonly ok: true; readonly value: GitQueryResult }
  | { readonly ok: false; readonly error: { readonly code: GitOperationErrorCode; readonly message?: string } }

/** Wire request of the `query` endpoint. */
export interface GitQueryRequest {
  readonly sessionId: string
  readonly query: GitQuery
}
