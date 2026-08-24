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

/**
 * 把人工改判应用到记录集(逐 turn 在三组间搬移条目;internal ↔ external,
 * sibling 恒服从改判方向)。返回新数组;无覆盖时原样返回(引用稳定)。
 */
export function applyAuthorOverrides(
  records: readonly TurnWorkRecord[],
  root: string,
  overrides: AuthorOverrideMap,
): readonly TurnWorkRecord[] {
  const bucket = overrides[root]
  if (bucket === undefined || Object.keys(bucket).length === 0) return records
  return records.map((turn) => {
    const move = (entries: readonly WorkEntry[], from: 'internal' | 'external'): {
      kept: readonly WorkEntry[]
      moved: readonly WorkEntry[]
    } => {
      const kept: WorkEntry[] = []
      const moved: WorkEntry[] = []
      for (const entry of entries) {
        if (bucket[entry.path] === from) moved.push(entry)
        else kept.push(entry)
      }
      return { kept, moved }
    }
    // external 方向:sibling + external 中被改判的留下,其余照旧。
    const internalOut = move(turn.internal, 'external')
    const siblingOut = move(turn.sibling, 'external')
    const externalOut = move(turn.external, 'internal')
    return {
      ...turn,
      internal: [...internalOut.kept, ...externalOut.moved],
      sibling: siblingOut.kept,
      external: [...externalOut.kept, ...siblingOut.moved, ...internalOut.moved],
    }
  })
}
