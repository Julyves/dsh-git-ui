/**
 * 观测时间线的插件数据存储读写(JSONL 编解码 + sessionKey 规范化)。
 *
 * 存储介质:本地插件数据存储 `<home>/plugin-data/dsh-git-ui/obs-<key>.jsonl`
 * (复用 createPluginDataStore 的白名单/原子写/大小上限;host 端直调,不经 RPC)。
 *
 * 文件名兼容:插件的文件名白名单为单段式 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`
 * (防目录穿越)。dsh 自带 sessionId 形如 `session-1` 原样通过;不合法字符
 * 替换为 `-`;若替换改变了原文,追加 `~<sha256前8位>` 保证唯一与合法。
 *
 * 格式:首行 `v1`,随后每行一个 minified JSON(紧凑键);
 * 解析宽容(坏行跳过),整体失败由调用方丢弃并 warn。
 */

import type { PathObservation } from './observation.ts'

/** 观测文件格式版本(首行)。 */
export const OBS_FILE_VERSION = 'v1'

/** 观测条目容量上限(与 ObservationLog 一致;序列化前裁剪)。 */
export const OBS_MAX_ENTRIES = 2000

/** 单条序列化(紧凑键:path/status/firstSeen/lastSeen/committed)。 */
interface ObsRow {
  p: string
  s: PathObservation['status']
  f: number
  l: number | null
  c: number | null
}

type ObsRowStatus = ObsRow['s']

/** path 字符串中的非法字符(白名单外的任意字符)。 */
const INVALID_PATH_CHARS = /[^A-Za-z0-9._-]/g

/** 规范化 sessionId 为合法单段文件名(白名单 [A-Za-z0-9][A-Za-z0-9._-]*)。
 * 不合法字符替换为 `-` 并修剪首尾;若替换改变了原文,追加 `-<指纹>` 保唯一;
 * 全非法 → 仅指纹(hex,天然合法)。 */
export function sessionStorageKey(sessionId: string): string {
  const replaced = sessionId.replace(INVALID_PATH_CHARS, '-').replace(/^-+|-+$/g, '')
  if (replaced === sessionId) return replaced
  if (replaced === '') return stabilityFingerprint(sessionId)
  return `${replaced}-${stabilityFingerprint(sessionId)}`
}

/** sessionId 的稳定指纹(8 位 hex;FNV-1a 实现,防碰撞/唯一性用途足够)。 */
export function stabilityFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x100000001b3)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 序列化为 JSONL 文本(首行版本)。 */
export function encodeObservations(entries: readonly PathObservation[]): string {
  const rows = entries.slice(0, OBS_MAX_ENTRIES).map((entry): ObsRow => ({
    p: entry.path,
    s: entry.status,
    f: entry.firstSeenAt,
    l: entry.lastSeenAt,
    c: entry.committedAt,
  }))
  return [OBS_FILE_VERSION, ...rows.map((row) => JSON.stringify(row))].join('\n')
}

/**
 * 解析 JSONL 文本。坏行跳过;首行非版本号 → 整体视为损坏返回 null。
 * 各行形状校验:任何字段非法即跳过该行。
 */
export function decodeObservations(raw: string): readonly PathObservation[] | null {
  const lines = raw.split('\n')
  const header = lines[0]
  if (header !== OBS_FILE_VERSION) return null
  const entries: PathObservation[] = []
  for (const line of lines.slice(1)) {
    if (line === '') continue
    const row = parseRow(line)
    if (row === null) continue
    entries.push({
      path: row.p,
      status: row.s,
      firstSeenAt: row.f,
      lastSeenAt: row.l,
      committedAt: row.c,
    })
  }
  return entries
}

function parseRow(line: string): ObsRow | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const p = record.p
  const s = record.s
  const f = record.f
  const l = record.l
  const c = record.c
  if (typeof p !== 'string' || p === '' || p !== p.trim()) return null
  if (!isStatus(s)) return null
  if (typeof f !== 'number' || !Number.isFinite(f)) return null
  if (l !== null && (typeof l !== 'number' || !Number.isFinite(l))) return null
  if (c !== null && (typeof c !== 'number' || !Number.isFinite(c))) return null
  return { p, s, f, l, c }
}

const STATUSES: readonly ObsRowStatus[] = [
  'added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted', 'typechange',
]

function isStatus(value: unknown): value is ObsRowStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}