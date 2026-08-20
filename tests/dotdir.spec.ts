/**
 * 点目录端到端集成测试（真实 git 仓库）：
 * `.agent/` 未跟踪目录 → 真实 git status → parseStatusOutput → 展示拆分。
 * 核心回归：目录从 git 输出到 UI 全链路保持「目录」身份，不被当文件。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createGitRunner } from '../src/host/git.ts'
import { gitInit, makeTempDir, realSubprocess, type ChildSpawnSpec } from './helpers.ts'
import { parseStatusOutput } from '../src/host/parser.ts'
import { splitChangePath } from '../src/client/file-tree.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const temps: string[] = []
async function tempDir(): Promise<string> {
  const dir = await makeTempDir()
  temps.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('dot-directory end-to-end (git status → parse → display split)', () => {
  it('keeps an untracked dot-dir a directory through the whole pipeline', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    await mkdir(join(dir, '.agent'), { recursive: true })
    await writeFile(join(dir, '.agent', 'note.md'), 'hi\n')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'x.txt'), 'x\n')
    await writeFile(join(dir, 'regular.txt'), 'y\n')

    const runner = createGitRunner(realSubprocess(), 5000, 1024 * 1024)
    const status = await runner.run(['git', 'status', '--porcelain=v1', '-z', '--branch'], { cwd: dir })
    expect(status.exitCode).toBe(0)

    const parsed = parseStatusOutput(status.stdout, 100)

    // git 输出保留目录条目尾斜杠：`.agent/`、`sub/`（整目录未跟踪折叠为一条）。
    const dot = parsed.changes.find((c) => c.path === '.agent/')
    expect(dot).toBeDefined()
    expect(dot!.status).toBe('untracked')
    expect(dot!.isDirectory).toBe(true)

    // 展示层由权威字段驱动：文件夹 + 正确名称，与「空名 + 弱化目录段」彻底绝缘。
    const view = splitChangePath(dot!.path, dot!.isDirectory)
    expect(view).toEqual({ name: '.agent', dir: '', isDir: true })

    // 普通文件不是目录。
    const file = parsed.changes.find((c) => c.path === 'regular.txt')
    expect(file).toBeDefined()
    expect(file!.isDirectory).toBe(false)

    // 普通未跟踪目录同样标记（同机制，防回归）。
    const sub = parsed.changes.find((c) => c.path === 'sub/')
    expect(sub).toBeDefined()
    expect(sub!.isDirectory).toBe(true)
  })

  it('treats a tracked plain file named like a dot-dir as a file', async () => {
    // `.agent` 若为普通文件（无尾斜杠），不应被误标记为目录。
    const dir = await tempDir()
    await gitInit(dir)
    await writeFile(join(dir, '.agent'), 'plain file\n')

    const runner = createGitRunner(realSubprocess(), 5000, 1024 * 1024)
    const status = await runner.run(['git', 'status', '--porcelain=v1', '-z', '--branch'], { cwd: dir })
    const parsed = parseStatusOutput(status.stdout, 100)
    const entry = parsed.changes.find((c) => c.path === '.agent')
    expect(entry).toBeDefined()
    expect(entry!.isDirectory).toBe(false)
    expect(splitChangePath(entry!.path, entry!.isDirectory)).toEqual({ name: '.agent', dir: '', isDir: false })
  })
})