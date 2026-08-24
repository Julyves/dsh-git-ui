/**
 * 归因人工纠错(overrides):用户对「这条记录归谁」的一票否决权。
 *
 * 语义:按 **工作区根 + 路径** 持久化的作者改判(internal ↔ external),
 * 会话无关——「这个文件从来都是我改的」是仓库级事实,不是会话级偏好。
 * 存储走既有插件数据通道(storageRead/Write → overrides.json,白名单单段名);
 * 应用在展示层(GitPill 统一过滤),host 归因管线零感知。
 */

import type { TurnWorkRecord, WorkEntry } from '../../host/types.ts'

/** 覆盖存储文件名(插件数据目录下的单段白名单名)。 */
export const OVERRIDES_FILE = 'overrides.json'

/** 改判目标:internal = 归本会话 AI;external = 归人工。 */
export type AuthorOverride = 'internal' | 'external'

/** 全量覆盖表:工作区根 → (路径 → 改判)。 */
export type AuthorOverrideMap = Readonly<Record<string, Readonly<Record<string, AuthorOverride>>>>

/** 解析 overrides.json 文本;损坏/空 → 空表(降级为无覆盖)。 */
export function parseOverrides(raw: string | null): AuthorOverrideMap {
  if (raw === null) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, Record<string, AuthorOverride>> = {}
    for (const [root, paths] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) continue
      const bucket: Record<string, AuthorOverride> = {}
      for (const [path, value] of Object.entries(paths as Record<string, unknown>)) {
        if (value === 'internal' || value === 'external') bucket[path] = value
      }
      out[root] = bucket
    }
    return out
  } catch {
    return {}
  }
}

/** 序列化覆盖表(全量重写;规模 = 人工改判数,天然有界)。 */
export function serializeOverrides(map: AuthorOverrideMap): string {
  return JSON.stringify(map)
}

/** 设置一条改判(不可变更新;value 为 null 时移除该条)。 */
export function setOverride(map: AuthorOverrideMap, root: string, path: string, value: AuthorOverride | null): AuthorOverrideMap {
  const bucket = { ...(map[root] ?? {}) }
  if (value === null) delete bucket[path]
  else bucket[path] = value
  return { ...map, [root]: bucket }
}

/** 合并两份覆盖表(本实例内存 × 磁盘):并集,键冲突取 `mine`(本实例
 * 的最新意图)。写前合并的基础——并发实例的磁盘改判与本实例尚未落盘的
 * 连续快速改判都不丢。 */
export function mergeOverrides(mine: AuthorOverrideMap, theirs: AuthorOverrideMap): AuthorOverrideMap {
  const out: Record<string, Record<string, AuthorOverride>> = {}
  for (const [root, paths] of Object.entries(theirs)) {
    out[root] = { ...paths }
  }
  for (const [root, paths] of Object.entries(mine)) {
    out[root] = { ...(out[root] ?? {}), ...paths }
  }
  return out
}

/**
 * 把人工改判应用到记录集(逐 turn 在三组间搬移条目)。override 是
 * **最终归属**语义:internal = 归本会话 AI;external = 归人工。
 * 搬移矩阵(修复 P1-1:旧实现漏掉 sibling→internal 方向,⇄ 在第三组失效):
 *   - 任意组 + override internal → internal 组(sibling 行的改判方向补全);
 *   - internal/sibling 组 + override external → external 组;
 *   - 已在目标组的条目无操作(改判回原组 = 撤销,效果等价);
 *   - 无改判条目原位保留(未改判的 sibling 留 sibling 组)。
 * 返回新数组;无覆盖时原样返回(引用稳定)。
 */
export function applyAuthorOverrides(
  records: readonly TurnWorkRecord[],
  root: string,
  overrides: AuthorOverrideMap,
): readonly TurnWorkRecord[] {
  const bucket = overrides[root]
  if (bucket === undefined || Object.keys(bucket).length === 0) return records
  return records.map((turn) => {
    const split = (entries: readonly WorkEntry[]): {
      readonly toInternal: readonly WorkEntry[]
      readonly toExternal: readonly WorkEntry[]
      readonly kept: readonly WorkEntry[]
    } => {
      const toInternal: WorkEntry[] = []
      const toExternal: WorkEntry[] = []
      const kept: WorkEntry[] = []
      for (const entry of entries) {
        const value = bucket[entry.path]
        if (value === 'internal') toInternal.push(entry)
        else if (value === 'external') toExternal.push(entry)
        else kept.push(entry)
      }
      return { toInternal, toExternal, kept }
    }
    const internal = split(turn.internal)
    const sibling = split(turn.sibling)
    const external = split(turn.external)
    return {
      ...turn,
      // 本组的 to* 桶拼回本组(override 与当前组一致 = 无操作;改判回原组
      // = 撤销,效果等价);异组的 to* 桶按 override 方向搬入。
      internal: [...internal.kept, ...internal.toInternal, ...sibling.toInternal, ...external.toInternal],
      sibling: sibling.kept,
      external: [...external.kept, ...external.toExternal, ...sibling.toExternal, ...internal.toExternal],
    }
  })
}
