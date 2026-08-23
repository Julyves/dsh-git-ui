/**
 * 平台工具注册表 → 写意图解析面的适配器。
 *
 * dsh 工具注册表(`ctx.tools`/ToolRegistry.get(name))的 ToolDefinition
 * 携带 `presentCall(args): ToolCallView`——这是平台自己声明的"写意图"
 * (write/edit 声明 DiffCallView.locations/diffs,bash 声明 TerminalCallView)。
 * 本适配器把它映射为业务层的 `ToolViewSlice` 扁平切片(未知卡字段剥除)。
 *
 * 降级:`tools` 服务缺失时返回 undefined——业务层回落到 args 兜底目录。
 */

import type { ToolPresenter, ToolViewSlice } from '../../host/write-paths.ts'

/** dsh ToolRegistry 的结构化切片(仅消费 get(name).presentCall)。 */
export interface ToolRegistryLike {
  get(name: string, scope?: unknown): { readonly presentCall?: (args: unknown) => unknown } | undefined
}

/** 构造业务层 ToolPresenter。registry 缺失 → undefined(降级);get 抛错 → 内部容错。 */
export function createToolPresenter(registry: ToolRegistryLike | undefined): ToolPresenter | undefined {
  if (registry === undefined) return undefined
  return {
    presentCall(name, args) {
      try {
        const tool = registry.get(name)
        if (tool?.presentCall === undefined) return undefined
        return mapView(tool.presentCall(args))
      } catch {
        // 工具注册表异常(个别工具 presenter 抛错):跳过该工具,不中断。
        return undefined
      }
    },
  }
}

/** dsh ToolCallView → 扁平切片(只保留业务关心的字段与卡的判别)。 */
function mapView(view: unknown): ToolViewSlice | undefined {
  if (typeof view !== 'object' || view === null) return undefined
  const record = view as Record<string, unknown>
  const card = record.card
  if (typeof card !== 'string' || card === '') return undefined
  const slice: { card: string; kind?: string; title?: string; cwd?: string; locations?: readonly { path: string }[]; diffs?: readonly { path: string }[] } = { card }
  if (typeof record.kind === 'string') slice.kind = record.kind
  if (typeof record.title === 'string') slice.title = record.title
  if (typeof record.cwd === 'string') slice.cwd = record.cwd
  const locations = record.locations
  if (Array.isArray(locations)) {
    const mapped = mapPaths(locations)
    if (mapped !== null) slice.locations = mapped
  }
  const diffs = record.diffs
  if (Array.isArray(diffs)) {
    const mapped = mapPaths(diffs)
    if (mapped !== null) slice.diffs = mapped
  }
  return slice
}

/** 从 `{path}` 对象数组提取路径;任一元素缺 path 则整体放弃(不产出半截)。 */
function mapPaths(rows: readonly unknown[]): readonly { readonly path: string }[] | null {
  const out: { path: string }[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return null
    const path = (row as Record<string, unknown>).path
    if (typeof path !== 'string') return null
    out.push({ path })
  }
  return out
}