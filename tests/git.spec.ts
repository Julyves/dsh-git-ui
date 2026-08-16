import { afterEach, describe, expect, it } from 'vitest'
import { createGitRunner } from '../src/host/git.ts'
import { gitInit, makeTempDir, realSubprocess, type ChildSpawnSpec } from './helpers.ts'
import { realpath, rm } from 'node:fs/promises'

const temps: string[] = []
async function tempDir(): Promise<string> {
  const dir = await makeTempDir()
  temps.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createGitRunner', () => {
  it('runs a command and collects stdout', async () => {
    const dir = await tempDir()
    await gitInit(dir)
    const runner = createGitRunner(realSubprocess(), 5000, 1024 * 1024)
    const result = await runner.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir })
    expect(result.exitCode).toBe(0)
    // macOS /var is a symlink to /private/var; compare against the realpath.
    expect(result.stdout.trim()).toBe(await realpath(dir))
    expect(result.timedOut).toBe(false)
  })

  it('surfaces a non-zero exit code (not a git repo)', async () => {
    const dir = await tempDir()
    const runner = createGitRunner(realSubprocess(), 5000, 1024 * 1024)
    const result = await runner.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir })
    expect(result.exitCode).toBe(128)
    expect(result.stderr).toContain('not a git repository')
  })

  it('flags a timed-out run', async () => {
    const dir = await tempDir()
    const runner = createGitRunner(realSubprocess(), 50, 1024 * 1024)
    const result = await runner.run(['sleep', '1'], { cwd: dir })
    expect(result.timedOut).toBe(true)
  }, 10_000)

  it('rejects on spawn-level failure (missing executable)', async () => {
    const dir = await tempDir()
    const runner = createGitRunner(realSubprocess(), 5000, 1024 * 1024)
    await expect(runner.run(['/definitely/not/a/real/binary'], { cwd: dir })).rejects.toThrow()
  })

  it('accepts the structural spec shape the host subprocess service uses', async () => {
    // Compile-time check that the adapter spec matches the host contract slice.
    const spec: ChildSpawnSpec = {
      argv: ['git', '--version'],
      cwd: '/tmp',
      stdio: { stdout: { collect: { maxBytes: 1024 } }, stderr: { collect: { maxBytes: 1024 } } },
      graceMs: 200,
    }
    expect(spec.argv).toBeDefined()
  })
})
