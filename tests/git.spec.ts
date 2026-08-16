import { afterEach, describe, expect, it } from 'vitest'
import { createGitRunner } from '../src/host/git.ts'
import { gitInit, makeTempDir, realSubprocess, type ChildSpawnSpec } from './helpers.ts'
import { realpath, rm, writeFile } from 'node:fs/promises'
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

  it('recovers the complete stdout from the spill file when the tail is lossy', async () => {
    const spillPath = join(await tempDir(), 'spill.log')
    const full = '## main\u0000 M a.txt\u0000?? u.txt\u0000'
    await writeFile(spillPath, full, 'utf8')
    // The fake host reports a lossy tail (head dropped) plus the spill file
    // holding the complete stream — the runner must prefer the spill file.
    const fake: SubprocessLike = {
      spawn: () => ({
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '?? u.txt\u0000', lossy: true, spillPath }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }),
    }
    const runner = createGitRunner(fake, 5000, 1024)
    const result = await runner.run(['git', 'status'], { cwd: '/tmp' })
    expect(result.stdout).toBe(full)
    expect(result.stdoutLossy).toBe(false)
  })

  it('keeps the tail and marks lossy when no spill file is available', async () => {
    const fake: SubprocessLike = {
      spawn: () => ({
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '?? u.txt\u0000', lossy: true }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }),
    }
    const runner = createGitRunner(fake, 5000, 1024)
    const result = await runner.run(['git', 'status'], { cwd: '/tmp' })
    expect(result.stdout).toBe('?? u.txt\u0000')
    expect(result.stdoutLossy).toBe(true)
  })

  it('falls back to the tail when the spill file cannot be read', async () => {
    const fake: SubprocessLike = {
      spawn: () => ({
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '?? u.txt\u0000', lossy: true, spillPath: '/definitely/missing/spill.log' }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }),
    }
    const runner = createGitRunner(fake, 5000, 1024)
    const result = await runner.run(['git', 'status'], { cwd: '/tmp' })
    expect(result.stdout).toBe('?? u.txt\u0000')
    expect(result.stdoutLossy).toBe(true)
  })

  it('aborts the run when the caller passes an aborted signal', async () => {
    let spawnedSignal: AbortSignal | undefined
    const fake: SubprocessLike = {
      spawn: (spec) => {
        spawnedSignal = spec.signal
        // The host throws on an already-aborted signal before spawning.
        if (spec.signal?.aborted === true) {
          return { done: Promise.reject(new Error('aborted before spawn')), collected: {} }
        }
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: '', lossy: false }) },
            stderr: { readFrom: () => ({ text: '', lossy: false }) },
          },
        }
      },
    }
    const runner = createGitRunner(fake, 5000, 1024)
    const aborted = new AbortController()
    aborted.abort()
    const result = await runner.run(['git', 'status'], { cwd: '/tmp', signal: aborted.signal })
    expect(spawnedSignal?.aborted).toBe(true)
    expect(result.timedOut).toBe(true)
  })
})

/** Minimal SubprocessLike for runner-level behavior tests. */
interface SubprocessLike {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdout: { collect: { maxBytes: number } }; stderr: { collect: { maxBytes: number } } }
    graceMs: number
    signal?: AbortSignal
  }): {
    done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
    collected: {
      stdout?: { readFrom(fromByte: number): { text: string; lossy: boolean; spillPath?: string } }
      stderr?: { readFrom(fromByte: number): { text: string; lossy: boolean; spillPath?: string } }
    }
  }
}
