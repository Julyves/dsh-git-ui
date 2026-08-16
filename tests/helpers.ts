/**
 * Test helpers: temporary git repositories driven by the real `git` binary,
 * plus a node child_process adapter for the structural SubprocessLike face
 * used by createGitRunner.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Run git synchronously in a directory; returns stdout or throws with stderr. */
export function git(dir: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${String(result.status)}): ${result.stderr ?? ''}`)
  }
  return result.stdout ?? ''
}

/** Run git synchronously returning the raw outcome (for exit-code expectations). */
export function gitStatus(dir: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Create a temp directory and return its absolute path. */
export async function makeTempDir(prefix = 'dsh-git-status-pill-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Initialize a git repository with a local identity, optionally with an initial commit. */
export async function gitInit(dir: string, { commit = true, initialFile = 'readme.txt' } = {}): Promise<void> {
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test User')
  if (commit) {
    await writeFile(join(dir, initialFile), 'hello\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'initial commit')
  }
}

/** Create a bare remote, add it as origin, and push main to it. Returns the remote path. */
export async function addBareRemote(dir: string, remoteName = 'origin'): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), 'dsh-git-status-pill-remote-'))
  await rm(remote, { recursive: true })
  await mkdir(remote)
  git(dir, 'init', '--bare', remote)
  git(dir, 'remote', 'add', remoteName, remote)
  git(dir, 'push', '-u', remoteName, 'main')
  return remote
}

/** Structural SubprocessLike handle over node:child_process. */
export interface CollectedHandle {
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  readonly collected: {
    stdout?: { readFrom(fromByte: number): { text: string; lossy: boolean } }
    stderr?: { readFrom(fromByte: number): { text: string; lossy: boolean } }
  }
}

export interface ChildSpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdout: { readonly collect: { readonly maxBytes: number } }
    readonly stderr: { readonly collect: { readonly maxBytes: number } }
  }
  readonly graceMs: number
  readonly signal?: AbortSignal
}

/** A SubprocessLike backed by the real git binary (collect-mode capture). */
export function realSubprocess(): { spawn(spec: ChildSpawnSpec): CollectedHandle } {
  return {
    spawn(spec) {
      let stdout = ''
      let stderr = ''
      const child = spawn(spec.argv[0] ?? 'git', spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: spec.signal,
      })
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ exitCode: code, signal: signal ?? null }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        },
      }
    },
  }
}
