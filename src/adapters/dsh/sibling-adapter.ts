/**
 * 兄弟会话(同工作区其他 dsh 会话)写路径适配。
 *
 * 归因三分法的 AI 侧补全:本会话 internal 之外,同工作区**其他 dsh 会话**
 * (含其 subagent)经工具写入的路径不应混入「外部(人工)」——用户心智里
 * 那也是 AI 改的。本适配器枚举兄弟会话、折叠其自有日志(跳过 seed 前的
 * 父历史),提取写路径全集(repo-relative,出根丢弃)。
 *
 * 判定与降级:
 *   - 兄弟 = sessions.list() 中 cwd 解析(realpath 归一,注入面可缺省)
 *     后等于本工作区根**或位于其子目录**、且不在本会话 subagent 子树内
 *     的会话——本工作区根来自 realpath,而 header.cwd 是会话启动原始
 *     路径,符号链接布局(macOS ~/Code 类)不归一会导致系统性漏配(P3-6);
 *     子目录会话同样工作于本仓库(其仓库外/子模块写入在路径归一时被
 *     丢弃,不会产生错误条目,安全纳入);
 *   - 冷兄弟会话(live 之外,events 不可读)→ 跳过(与 subagent 同款限制);
 *   - `sessions` 服务缺失 → 空集(全落 external,与旧行为一致)。
 *
 * 零 git 命令:纯会话日志读取 + 可选 realpath(fs 注入),延续省命令纪律。
 */

import type { ToolPresenter } from '../../host/write-paths.ts'
import { extractWritePaths } from '../../host/write-paths.ts'
import { sliceEvents, type SessionLike } from './session-log.ts'
import type { SessionsLike } from './subagent-adapter.ts'

/** 路径解析注入面:realpath 归一(适配层注入 node:fs/promises.realpath;
 * 缺省 = 字符串原样——符号链接布局退化为精确匹配,行为同旧版)。 */
export interface SiblingPathResolver {
  realpath?(path: string): Promise<string>
}

/** 路径归一:统一分隔符并去尾斜杠。 */
function normalizeCwd(cwd: string): string {
  return cwd.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** cwd 是否属于本工作区(等于根或位于子目录)。 */
function isWithin(cwd: string, root: string): boolean {
  return cwd === root || cwd.startsWith(`${root}/`)
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
export async function collectSiblingWrites(
  selfId: string,
  sessions: SessionsLike | undefined,
  workspaceRoot: string,
  presenter: ToolPresenter | undefined,
  resolver: SiblingPathResolver = {},
): Promise<ReadonlySet<string>> {
  const out = new Set<string>()
  if (sessions === undefined) return out
  const root = normalizeCwd(workspaceRoot)
  if (root === '') return out
  const excluded = descendantIds(selfId, sessions)
  const resolve = resolver.realpath ?? (async (path: string) => path)
  const candidates: string[] = []
  for (const entry of sessions.list() ?? []) {
    if (excluded.has(entry.id)) continue
    const cwd = typeof entry.header?.cwd === 'string' ? entry.header.cwd : null
    if (cwd === null) continue
    // realpath 归一(失败回退原字符串:路径消失等)后判「等于根或子目录」。
    let resolved = cwd
    try {
      resolved = await resolve(cwd)
    } catch {
      // 保守:解析失败按原路径精确匹配。
    }
    if (isWithin(normalizeCwd(resolved), root)) candidates.push(entry.id)
  }
  for (const id of candidates) {
    const session = sessions.get(id)
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
