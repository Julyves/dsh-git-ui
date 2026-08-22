/**
 * 插件数据存储测试：真实临时目录下的读写 / 原子写 / 文件名白名单 / 越界防护。
 * 与 git 测试同风格——真实 fs，无 mock。
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPluginDataStore, resolvePluginDataRoot, validateFileName,
  type PluginDataFs,
} from '../src/host/plugin-data.ts'

async function withStore(): Promise<{ root: string; store: ReturnType<typeof createPluginDataStore>; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-ui-plugin-data-'))
  const fs: PluginDataFs = { readFile, writeFile, mkdir, rename, rm }
  return {
    root: join(root, 'plugin-data', 'dsh-git-ui'),
    store: createPluginDataStore(fs, { root: join(root, 'plugin-data', 'dsh-git-ui') }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe('validateFileName（白名单）', () => {
  it('accepts single-segment plain names', () => {
    expect(validateFileName('settings.json')).toBe(true)
    expect(validateFileName('a.b.c')).toBe(true)
    expect(validateFileName('1-list.txt')).toBe(true)
  })

  it('rejects traversal / hidden / path separators / empty', () => {
    expect(validateFileName('')).toBe(false)
    expect(validateFileName('../x')).toBe(false)
    expect(validateFileName('a/b')).toBe(false)
    expect(validateFileName('a\\b')).toBe(false)
    expect(validateFileName('/etc/passwd')).toBe(false)
    expect(validateFileName('.hidden')).toBe(false)
    expect(validateFileName('..')).toBe(false)
  })
})

describe('resolvePluginDataRoot（home 解析）', () => {
  it('prefers the explicit config, then $DSH_HOME, then ~/.dsh', () => {
    expect(resolvePluginDataRoot('/custom', {})).toContain('/custom/plugin-data/dsh-git-ui')
    const fromEnv = resolvePluginDataRoot(undefined, { DSH_HOME: '/env-home' })
    expect(fromEnv).toBe('/env-home/plugin-data/dsh-git-ui')
    const fallback = resolvePluginDataRoot(undefined, {})
    expect(fallback.endsWith('/.dsh/plugin-data/dsh-git-ui')).toBe(true)
    // 空 DSH_HOME 视同未设置
    const blank = resolvePluginDataRoot(undefined, { DSH_HOME: '  ' })
    expect(blank.endsWith('/.dsh/plugin-data/dsh-git-ui')).toBe(true)
  })
})

describe('createPluginDataStore（读写）', () => {
  it('writes and reads back atomically (no temp residue)', async () => {
    const { store, root, cleanup } = await withStore()
    try {
      const result = await store.write({ file: 'settings.json', data: '{"v":2}' })
      expect(result.ok).toBe(true)
      const read = await store.read({ file: 'settings.json' })
      expect(read).toEqual({ ok: true, value: '{"v":2}' })
      // 直接落盘（无临时残留）
      const files = await readFile(join(root, 'settings.json'), 'utf8')
      expect(files).toBe('{"v":2}')
      expect(await readdir(root)).toEqual(['settings.json'])
    } finally {
      await cleanup()
    }
  })

  it('returns value null for a missing file (not an error)', async () => {
    const { store, cleanup } = await withStore()
    try {
      expect(await store.read({ file: 'nope.json' })).toEqual({ ok: true, value: null })
    } finally {
      await cleanup()
    }
  })

  it('rejects unsafe file names before touching the disk', async () => {
    const { store, cleanup } = await withStore()
    try {
      const result = await store.write({ file: '../escape.json', data: 'x' })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-file' } })
      expect(await store.read({ file: '../escape.json' })).toMatchObject({ ok: false, error: { code: 'invalid-file' } })
    } finally {
      await cleanup()
    }
  })

  it('round-trips a large but bounded payload', async () => {
    const { store, cleanup } = await withStore()
    try {
      const data = 'x'.repeat(100_000)
      expect((await store.write({ file: 'big.json', data })).ok).toBe(true)
      const read = await store.read({ file: 'big.json' })
      expect(read.ok && read.value?.length).toBe(100_000)
    } finally {
      await cleanup()
    }
  })

  it('overwrites an existing file (rename semantics)', async () => {
    const { store, root, cleanup } = await withStore()
    try {
      await store.write({ file: 'settings.json', data: 'first' })
      await store.write({ file: 'settings.json', data: 'second' })
      expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe('second')
    } finally {
      await cleanup()
    }
  })
})
