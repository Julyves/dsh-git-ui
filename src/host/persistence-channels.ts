/**
 * 插件数据持久化通道工厂。
 *
 * 4 个通道（obs/narr/fp/ps）结构完全同构：仅文件前缀与错误标签不同，
 * read/write 逻辑一致（read 不存在/IO 失败均按 null；write 失败抛错）。
 * 抽工厂消除重复，host/index.ts 仅保留薄包装。
 */
import { sessionStorageKey } from './obs-file.ts'
import type { GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult } from './types.ts'

/** 一个持久化通道：read 返回原始文本（null = 不存在/失败）；write 失败抛错。 */
export interface PersistenceChannel {
  read(): Promise<string | null>
  write(raw: string): Promise<void>
}

/** storage 的结构切片（createPluginDataStore 返回的 read/write 面）。 */
export interface PersistenceStorage {
  read(request: GitStorageReadRequest): Promise<GitStorageReadResult>
  write(request: GitStorageWriteRequest): Promise<GitStorageWriteResult>
}

/**
 * 构造一个 `<prefix>-<sessionKey>.jsonl` 持久化通道（原子写/白名单/上限复用）。
 *
 * @param storage 插件数据存储（read/write 结构面）
 * @param prefix  文件前缀（obs/narr/fp/ps）
 * @param label   错误日志标签（与 prefix 同名即可）
 * @param sessionId 会话 id（经 sessionStorageKey 归一为安全文件名）
 */
export function persistenceChannel(
  storage: PersistenceStorage,
  prefix: string,
  label: string,
  sessionId: string,
): PersistenceChannel {
  const file = `${prefix}-${sessionStorageKey(sessionId)}.jsonl`
  return {
    read: async () => {
      const result = await storage.read({ file })
      // 不存在(null)与 IO 失败均按空处理
      if (!result.ok) return null
      return result.value
    },
    write: async (raw) => {
      const result = await storage.write({ file, data: raw })
      if (!result.ok) throw new Error(`${label} write failed: ${result.error.message}`)
    },
  }
}
