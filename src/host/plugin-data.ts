/**
 * 插件数据存储：落盘于 Harness home 的 `plugin-data/dsh-git-ui/`。
 *
 * 目录约定（后续插件沿用同族模式）：`<home>/plugin-data/<插件名>/<file>`。
 * home 解析遵循 dsh 惯例：配置显式 `dshHome` → `$DSH_HOME` → `~/.dsh`。
 *
 * 安全与稳健性：
 *   - 文件名白名单（单文件、无路径分隔、无特殊字符），杜绝目录穿越；
 *   - 原子写（写 `<file>.<pid>.tmp` 后 rename），崩溃/并发不产生半截文件；
 *   - 读失败仅对「文件不存在」解析为 null；其余 IO 错误上报（不吞）；
 *   - 大小上限：读取 ≤ maxReadBytes、写入 ≤ maxWriteBytes（防御性防呆）。
 *
 * 本模块无框架依赖（结构化注入 node:fs/promises 切片），可直接单测。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { GitStorageReadRequest, GitStorageReadResult, GitStorageWriteRequest, GitStorageWriteResult } from './types.ts'

/** 合法文件名：非空、单段（无 / 与 \）、不以点或连字符开头（防隐藏/.. 变体）。 */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 单文件读取上限（字节）。 */
export const MAX_READ_BYTES = 1024 * 1024
/** 单文件写入上限（字节）。 */
export const MAX_WRITE_BYTES = 512 * 1024

/** 临时文件自增序号：并发写（客户端 flush 与去抖落盘可重叠）时避免同一
 * `pid.tmp` 路径互踩——后写的 rename 会把先写的临时文件顶掉或 ENOENT。 */
let tempSeq = 0

/** node:fs/promises 的结构化切片（仅本模块需要的成员）。 */
export interface PluginDataFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, options: { readonly encoding: 'utf8' }): Promise<void>
  mkdir(path: string, options: { readonly recursive: true }): Promise<unknown>
  rename(oldPath: string, newPath: string): Promise<void>
  rm(path: string, options: { readonly force?: boolean }): Promise<unknown>
}

/** 解析 Harness home：配置显式值 → `$DSH_HOME` → `~/.dsh`（与 dsh-home-paths 同序）。 */
export function resolvePluginDataRoot(dshHome: string | undefined, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  const home = dshHome ?? (fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh'))
  return join(home, 'plugin-data', 'dsh-git-ui')
}

/** 校验文件名为白名单内的单文件名；非法返回 null。 */
export function validateFileName(file: string): boolean {
  return typeof file === 'string' && FILE_NAME.test(file)
}

/** 把 Node 层错误归一化为「不存在 / IO 错误」判定。 */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}

/**
 * 构造插件数据存储。`fs` 为注入的文件系统切片（host 适配层传 node:fs/promises
 * 的对应成员；测试传内存桩）。
 */
export function createPluginDataStore(
  fs: PluginDataFs,
  options: { readonly root?: string; readonly maxReadBytes?: number; readonly maxWriteBytes?: number } = {},
): {
  readonly root: string
  read(request: GitStorageReadRequest): Promise<GitStorageReadResult>
  write(request: GitStorageWriteRequest): Promise<GitStorageWriteResult>
} {
  const root = options.root ?? join(homedir(), '.dsh', 'plugin-data', 'dsh-git-ui')
  const maxReadBytes = options.maxReadBytes ?? MAX_READ_BYTES
  const maxWriteBytes = options.maxWriteBytes ?? MAX_WRITE_BYTES

  return {
    root,

    async read(request): Promise<GitStorageReadResult> {
      if (!validateFileName(request.file)) {
        return { ok: false, error: { code: 'invalid-file', message: `invalid file name: ${request.file}` } }
      }
      const path = join(root, request.file)
      let raw: string
      try {
        raw = await fs.readFile(path, 'utf8')
      } catch (error) {
        if (isNotFound(error)) return { ok: true, value: null }
        return { ok: false, error: { code: 'io-error', message: error instanceof Error ? error.message : String(error) } }
      }
      if (raw.length > maxReadBytes) {
        return { ok: false, error: { code: 'io-error', message: `file exceeds ${String(maxReadBytes)} bytes` } }
      }
      return { ok: true, value: raw }
    },

    async write(request): Promise<GitStorageWriteResult> {
      if (!validateFileName(request.file)) {
        return { ok: false, error: { code: 'invalid-file', message: `invalid file name: ${request.file}` } }
      }
      if (request.data.length > maxWriteBytes) {
        return { ok: false, error: { code: 'io-error', message: `data exceeds ${String(maxWriteBytes)} bytes` } }
      }
      const target = join(root, request.file)
      const temp = join(root, `${request.file}.${String(process.pid)}.${String((tempSeq += 1))}.tmp`)
      try {
        await fs.mkdir(root, { recursive: true })
        await fs.writeFile(temp, request.data, { encoding: 'utf8' })
        await fs.rename(temp, target)
      } catch (error) {
        // 尽力清理残留临时文件；清理失败不影响错误上报。
        try {
          await fs.rm(temp, { force: true })
        } catch {
          // swallowed: 残留 tmp 无害，下次原子写会覆盖同 pid 路径
        }
        return { ok: false, error: { code: 'io-error', message: error instanceof Error ? error.message : String(error) } }
      }
      return { ok: true }
    },
  }
}
