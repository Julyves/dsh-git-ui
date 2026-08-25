/**
 * 点目录集成测试（真实 git 仓库）。
 *
 * 两层回归：
 *  1. 解析器韧性——直接喂「无 -uall」的折叠输出 `?? .agent/`，解析器仍须权威标记
 *     目录身份（防御：未来 git 版本 / 他人配置 status.showUntrackedFiles=normal
 *     时仍可能出现折叠条目，parseStatusOutput 是公开导出，须对任意 porcelain 健壮）。
 *  2. 宿主端到端——snapshotForSession 用 --untracked-files=all，强制枚举未跟踪
 *     目录内部文件：`.agent/note.md` 须作为独立未跟踪文件出现，而非折叠为
 *     单条 `.agent/`（根因回归——隐藏目录内部变更此前因 git 折叠而从不展示）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createGitRunner } from '../src/host/git.ts'
import { gitInit, makeTempDir, realSubprocess } from './helpers.ts'
import { snapshotForSession, type GitStatusConfig, type SessionLookup, type SnapshotDeps } from '../src/host/core.ts'
import { parseStatusOutput } from '../src/host/parser.ts'
import { splitChangePath } from '../src/client/file-tree.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { realpath, stat } from 'node:fs/promises'
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

const CONFIG: GitStatusConfig = {
  timeoutMs: 5000,
  maxStatusBytes: 4 * 1024 * 1024,
  maxChanges: 100,
  defaultRefreshIntervalMs: 30_000,
}

/** 会话查找：固定指向一个 cwd（live + persisted 同值）。 */
function fixedSession(cwd: string | undefined): SessionLookup {
  return {
    liveCwd: () => cwd,
    persistedMeta: async () => (cwd === undefined ? { cwd: undefined } : { cwd }),
  }
}

/** 基于真实 git 二进制的完整 deps（与 core.spec 同构）。 */
function depsFor(cwd: string | undefined): SnapshotDeps {
  return { run: createGitRunner(realSubprocess(), CONFIG.timeoutMs, CONFIG.maxStatusBytes), fs: { realpath, stat }, sessions: fixedSession(cwd) }
}

describe('dot-directory end-to-end (git status → parse → display split)', () => {
  it('parser still marks a collapsed dot-dir entry as a directory (resilience)', async () => {
    // 直接用「无 -uall」命令（host 不再用此命令，但解析器作为公开导出须对
    // 折叠输出健壮）：`.agent/`、`sub/` 折叠为单条尾斜杠条目，须权威标记目录。
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

    // 折叠输出保留目录条目尾斜杠：`.agent/`、`sub/`（整目录未跟踪折叠为一条）。
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

  it('snapshotForSession enumerates files inside an untracked dot-dir (root-cause regression)', async () => {
    // 根因回归：host 用 --untracked-files=all，强制枚举未跟踪目录内部文件。
    // 修复前：`.agent/` 折叠为单条 `?? .agent/`，note.md 从不进入变更清单。
    // 修复后：`.agent/note.md` 作为独立未跟踪文件出现，可对照、可暂存。
    const dir = await tempDir()
    await gitInit(dir)
    await mkdir(join(dir, '.agent'), { recursive: true })
    await mkdir(join(dir, '.agent', 'skills'), { recursive: true })
    await writeFile(join(dir, '.agent', 'note.md'), 'hi\n')
    await writeFile(join(dir, '.agent', 'skills', 'codegraph'), 'skill\n')
    await mkdir(join(dir, '.tianqi'), { recursive: true })
    await writeFile(join(dir, '.tianqi', 'config.json'), '{}\n')
    await writeFile(join(dir, 'regular.txt'), 'y\n')

    const result = await snapshotForSession(depsFor(dir), CONFIG, 's1')
    expect(result.ok).toBe(true)

    const snapshot = result.ok ? result.value : undefined
    expect(snapshot).toBeDefined()

    // 折叠条目 `.agent/` 不再出现——内部文件被逐一枚举。
    const collapsedDot = snapshot!.changes.find((c) => c.path === '.agent/')
    expect(collapsedDot).toBeUndefined()
    const collapsedTianqi = snapshot!.changes.find((c) => c.path === '.tianqi/')
    expect(collapsedTianqi).toBeUndefined()

    // 内部文件作为独立未跟踪条目出现（含嵌套路径），可对照、可暂存。
    const note = snapshot!.changes.find((c) => c.path === '.agent/note.md')
    expect(note).toBeDefined()
    expect(note!.status).toBe('untracked')
    expect(note!.staged).toBe(false)
    expect(note!.isDirectory).toBe(false)
    expect(splitChangePath(note!.path, note!.isDirectory)).toEqual({ name: 'note.md', dir: '.agent', isDir: false })

    const skill = snapshot!.changes.find((c) => c.path === '.agent/skills/codegraph')
    expect(skill).toBeDefined()
    expect(skill!.isDirectory).toBe(false)

    const cfg = snapshot!.changes.find((c) => c.path === '.tianqi/config.json')
    expect(cfg).toBeDefined()
    expect(cfg!.isDirectory).toBe(false)

    // 普通未跟踪文件不受影响。
    expect(snapshot!.changes.find((c) => c.path === 'regular.txt')).toBeDefined()

    // 计数反映独立文件数（4 个未跟踪文件），而非折叠后的 2 个目录。
    expect(snapshot!.untracked).toBe(4)
    expect(snapshot!.dirty).toBe(true)
  })
})
