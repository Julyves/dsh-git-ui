/**
 * Hand-written Typert Remote contribution for the gitInfo namespace.
 *
 * The host side exposes `gitInfo/snapshot` through SRC discovery (decorator
 * metadata); the browser side must mount an equivalent strict contribution
 * (requireStrictDescriptor enforces zod codecs), so the schemas here mirror
 * `src/host/types.ts` by hand. `tests/client/remote.spec.ts` keeps the two in
 * sync by parsing host-typed samples through these schemas.
 */
import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export const gitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  dateIso: z.string(),
})

/** GraphCommit：带父提交哈希与 ref 装饰的提交（图渲染 + 分支胶囊）。 */
export const gitGraphCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  dateIso: z.string(),
  parents: z.array(z.string()),
  refs: z.array(z.object({
    kind: z.enum(['branch', 'remote', 'tag']),
    name: z.string(),
    head: z.boolean(),
  })),
})

export const gitChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted', 'typechange']),
  staged: z.boolean(),
})

export const gitSnapshotSchema = z.object({
  root: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  unborn: z.boolean(),
  dirty: z.boolean(),
  staged: z.number(),
  modified: z.number(),
  untracked: z.number(),
  ahead: z.number(),
  behind: z.number(),
  lastCommit: gitCommitSchema.nullable(),
  recentCommits: z.array(gitCommitSchema),
  changes: z.array(gitChangeSchema),
  truncated: z.boolean(),
  refreshIntervalMs: z.number(),
  checkedAt: z.number(),
})

export const gitSnapshotFailureSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('session-not-found'), sessionId: z.string() }),
  z.object({ code: z.literal('cwd-unavailable'), sessionId: z.string() }),
  z.object({ code: z.literal('path-not-found'), path: z.string() }),
  z.object({ code: z.literal('git-unavailable'), detail: z.string() }),
  z.object({ code: z.literal('timeout') }),
  z.object({ code: z.literal('not-a-git-repo') }),
])

export const gitSnapshotResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: gitSnapshotSchema }),
  z.object({ ok: z.literal(false), error: gitSnapshotFailureSchema }),
])

export const gitSnapshotRequestSchema = z.object({
  sessionId: z.string(),
})

/** One management action (mirrors `GitAction` in src/host/types.ts). */
export const gitActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), paths: z.array(z.string()) }),
  z.object({ kind: z.literal('stage-all') }),
  z.object({ kind: z.literal('unstage'), paths: z.array(z.string()) }),
  z.object({ kind: z.literal('unstage-all') }),
  z.object({ kind: z.literal('discard'), paths: z.array(z.string()) }),
  z.object({ kind: z.literal('discard-all') }),
  z.object({
    kind: z.literal('commit'),
    message: z.string(),
    paths: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal('branch-create'), name: z.string(), from: z.string().optional() }),
  z.object({ kind: z.literal('branch-checkout'), name: z.string() }),
  z.object({ kind: z.literal('branch-delete'), name: z.string(), force: z.boolean().optional() }),
])

export const gitOperationErrorSchema = z.object({
  code: z.enum([
    'session-not-found', 'cwd-unavailable', 'path-not-found',
    'not-a-git-repo', 'invalid-path', 'invalid-name', 'git-error', 'timeout',
  ]),
  message: z.string().optional(),
})

export const gitActionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: gitSnapshotSchema, output: z.string().optional() }),
  z.object({ ok: z.literal(false), error: gitOperationErrorSchema }),
])

export const gitActionRequestSchema = z.object({
  sessionId: z.string(),
  action: gitActionSchema,
})

/** 一条只读查询（镜像 src/host/types.ts 的 GitQuery）。 */
export const gitQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('history'), limit: z.number(), skip: z.number(), ref: z.string().optional(), search: z.string().optional(), author: z.string().optional(), since: z.string().optional() }),
  z.object({ kind: z.literal('show'), ref: z.string() }),
  z.object({ kind: z.literal('branches') }),
  z.object({ kind: z.literal('tags') }),
  z.object({ kind: z.literal('authors') }),
])

const gitFileStatSchema = z.object({ path: z.string(), status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted', 'typechange']) })
const gitBranchSchema = z.object({ name: z.string(), shortHash: z.string().nullable() })

export const gitQueryResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('history'), commits: z.array(gitGraphCommitSchema), total: z.number() }),
  z.object({ kind: z.literal('show'), ref: z.string(), commit: gitCommitSchema.nullable(), body: z.string(), stats: z.array(gitFileStatSchema) }),
  z.object({ kind: z.literal('branches'), current: z.string().nullable(), defaultBranch: z.string().nullable(), local: z.array(gitBranchSchema), remote: z.array(gitBranchSchema) }),
  z.object({ kind: z.literal('tags'), tags: z.array(gitBranchSchema) }),
  z.object({ kind: z.literal('authors'), authors: z.array(z.string()) }),
])

export const gitQueryResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: gitQueryResultSchema }),
  z.object({ ok: z.literal(false), error: gitOperationErrorSchema }),
])

export const gitQueryRequestSchema = z.object({
  sessionId: z.string(),
  query: gitQuerySchema,
})

/** The contribution mounted into `ctx.remote` by the client plugin body. */
export const gitInfoRemote: TypertRemoteContribution = {
  package: 'dsh-git-ui',
  descriptors: [
    {
      id: 'dsh-git-ui#gitInfo/snapshot',
      service: 'gitInfo',
      namespace: 'gitInfo',
      method: 'snapshot',
      invocation: { kind: 'direct' },
      // Mirrors the host SRC descriptor: the trailing `signal` parameter is
      // the cancellation slot, so an aborted call also stops the host-side
      // git runs instead of letting them finish.
      cancellation: { parameter: 'signal' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-git-ui/types#GitSnapshotRequest',
            schema: gitSnapshotRequestSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-git-ui/types#GitSnapshotResult',
        schema: gitSnapshotResultSchema,
      },
    },
    {
      id: 'dsh-git-ui#gitInfo/run',
      service: 'gitInfo',
      namespace: 'gitInfo',
      method: 'run',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-git-ui/types#GitActionRequest',
            schema: gitActionRequestSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-git-ui/types#GitActionResult',
        schema: gitActionResultSchema,
      },
    },
    {
      id: 'dsh-git-ui#gitInfo/query',
      service: 'gitInfo',
      namespace: 'gitInfo',
      method: 'query',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-git-ui/types#GitQueryRequest',
            schema: gitQueryRequestSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-git-ui/types#GitQueryResponse',
        schema: gitQueryResponseSchema,
      },
    },
  ],
}
