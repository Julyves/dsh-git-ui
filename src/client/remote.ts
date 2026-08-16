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

/** The contribution mounted into `ctx.remote` by the client plugin body. */
export const gitInfoRemote: TypertRemoteContribution = {
  package: 'dsh-git-status',
  descriptors: [
    {
      id: 'dsh-git-status#gitInfo/snapshot',
      service: 'gitInfo',
      namespace: 'gitInfo',
      method: 'snapshot',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-git-status/types#GitSnapshotRequest',
            schema: gitSnapshotRequestSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-git-status/types#GitSnapshotResult',
        schema: gitSnapshotResultSchema,
      },
    },
  ],
}
