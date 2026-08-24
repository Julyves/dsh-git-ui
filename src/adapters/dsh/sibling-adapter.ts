/**
 * 兄弟会话(同工作区其他 dsh 会话)写路径适配。
 *
 * 归因三分法的 AI 侧补全:本会话 internal 之外,同工作区**其他 dsh 会话**
 * (含其 subagent)经工具写入的路径不应混入「外部(人工)」——用户心智里
 * 那也是 AI 改的。本适配器枚举兄弟会话、折叠其自有日志(跳过 seed 前的
 * 父历史),提取写路径全集(repo-relative,出根丢弃)。
 *
 * 判定与降级:
 *   - 兄弟 = sessions.list() 中 cwd 归一后等于本工作区根、且不在本会话
 *     subagent 子树内的会话(cwd 不等/缺失 → 跳过:保守,防误归因);
 *   - 冷兄弟会话(live 之外,events 不可读)→ 跳过(与 subagent 同款限制);
 *   - `sessions` 服务缺失 → 空集(全落 external,与旧行为一致)。
 *
 * 零 git 命令:纯会话日志读取,延续记录查询的省命令纪律。
 */

import type { ToolPresenter } from '../../host/write-paths.ts'
import { extractWritePaths } from '../../host/write-paths.ts'
import { sliceEvents, type SessionLike } from './session-log.ts'
import type { SessionsLike } from './subagent-adapter.ts'

/** 路径归一:统一分隔符并去尾斜杠(cwd 精确匹配用;不做 realpath——
 * 兄弟 cwd 与本工作区根的符号链接差异属可接受的保守漏配,文档化)。 */
function normalizeCwd(cwd: string): string {
  return cwd.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** 本会话 subagent 子树(含孙代)的会话 id 集合:从 self 出发沿
 * meta.parentSession 闭包传递——子树成员的写入已由 internal 归并,
 * 不得再计为兄弟。 */
function descendantIds(selfId: string, sessions: SessionsLike): ReadonlySet<string> {
  const excluded = new Set<string>([selfId])
  let grew = true
  while (grew) {
    grew = false
    for (const entry of sessions.list() ?? []) {
      if (excluded.has(entry.id)) continue
      const meta = entry.header?.meta
      const parent = typeof meta?.parentSession === 'string' ? meta.parentSession : null
      if (parent !== null && excluded.has(parent)) {
        excluded.add(entry.id)
        grew = true
      }
    }
  }
  return excluded
}

/**
 * 收集兄弟会话(同工作区、非本会话子树)写过的路径全集。
 * 返回 repo-relative 集合(组装层按窗口归入各 turn 的 sibling 组)。
 */
export function collectSiblingWrites(
  selfId: string,
  sessions: SessionsLike | undefined,
  workspaceRoot: string,
  presenter: ToolPresenter | undefined,
): ReadonlySet<string> {
  const out = new Set<string>()
  if (sessions === undefined) return out
  const root = normalizeCwd(workspaceRoot)
  if (root === '') return out
  const excluded = descendantIds(selfId, sessions)
  const candidates = (sessions.list() ?? []).filter((entry) => {
    if (excluded.has(entry.id)) return false
    const cwd = typeof entry.header?.cwd === 'string' ? entry.header.cwd : null
    return cwd !== null && normalizeCwd(cwd) === root
  })
  for (const candidate of candidates) {
    const session = sessions.get(candidate.id)
    if (session === undefined) continue // 冷会话:跳过(文档化限制)
    const events = sliceEvents(session)
    // 最后一个 session/end-seed 之后才是该会话自己的工作(seed = 他人历史)。
    let fromSeq = 0
    for (const event of events) {
      if (event.type === 'session/end-seed') fromSeq = event.seq + 1
    }
    for (const event of events) {
      if (event.type !== 'tool/call' || event.seq < fromSeq) continue
      for (const path of extractWritePaths(event.data.name, event.data.arguments, workspaceRoot, presenter)) {
        out.add(path)
      }
    }
  }
  return out
}
