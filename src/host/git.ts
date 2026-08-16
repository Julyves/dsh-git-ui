/**
 * Git command execution adapter over the host subprocess service.
 *
 * The widget only needs a tiny slice of the subprocess contract; declaring it
 * structurally here (instead of depending on the npm package, whose registry
 * chain is incomplete) keeps the plugin buildable standalone while remaining
 * wire-compatible with the host's `subprocess` service.
 */
import { readFile } from 'node:fs/promises'

/** One collected stream disposition (matches the host SubprocessCollect). */
interface CollectDisposition {
  readonly collect: {
    readonly maxBytes: number
    /**
     * Spill disposition: when the stream overflows the in-memory tail, the
     * host appends the COMPLETE stream to a private spill file (up to this
     * cap) and `readFrom` reports its path. Without it, only the tail is
     * ever retained and the head (and its change counts) is lost.
     */
    readonly spill?: { readonly maxBytes: number }
  }
}

/** Structural slice of the host subprocess spawn spec. */
interface SpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdout: CollectDisposition
    readonly stderr: CollectDisposition
  }
  readonly graceMs: number
  readonly signal?: AbortSignal
}

/** Structural slice of the host subprocess handle (collect-mode output). */
interface SpawnHandle {
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  readonly collected: {
    readonly stdout?: {
      readFrom(fromByte: number): { readonly text: string; readonly lossy: boolean; readonly spillPath?: string }
    }
    readonly stderr?: {
      readFrom(fromByte: number): { readonly text: string; readonly lossy: boolean; readonly spillPath?: string }
    }
  }
}

/** Minimal subprocess-service face the adapter consumes. */
export interface SubprocessLike {
  spawn(spec: SpawnSpec): SpawnHandle
}

/** One git command outcome. */
export interface GitRunResult {
  /** Process exit code; null when terminated by a signal. */
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** True when the run was killed by our timeout (or the caller's signal). */
  readonly timedOut: boolean
  /**
   * True when the final stdout text is still incomplete: the collected
   * output overflowed its byte cap AND the spill file was unavailable (no
   * spill configured on the host, or the spill cap also overflowed).
   */
  readonly stdoutLossy: boolean
}

/** The run primitive the snapshot orchestration uses. */
export interface GitRunner {
  run(argv: readonly string[], opts: { readonly cwd: string; readonly signal?: AbortSignal }): Promise<GitRunResult>
}

/**
 * Adapt the host subprocess service into a `GitRunner` with a per-command
 * timeout. A timed-out run resolves (never rejects) with `timedOut: true`;
 * only spawn-level failures (e.g. git not installed) reject.
 *
 * Overflow handling: stdout/stderr collect with a spill cap of
 * `maxBytes * 16` (default 4 MiB memory tail → 64 MiB spill file). When the
 * tail overflowed but the spill file holds the complete stream, the runner
 * reads the file and reports `stdoutLossy: false` — the change COUNTS stay
 * exact. `stdoutLossy: true` is reserved for the doubly-overflowed case
 * (spill also exceeded), where the head is genuinely lost.
 */
export function createGitRunner(subprocess: SubprocessLike, timeoutMs: number, maxBytes: number): GitRunner {
  const spillMaxBytes = maxBytes * 16
  return {
    async run(argv, opts) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const signal = opts.signal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, opts.signal])
        const handle = subprocess.spawn({
          argv,
          cwd: opts.cwd,
          stdio: {
            stdout: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
            stderr: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
          },
          graceMs: 200,
          signal,
        })
        let outcome: Awaited<SpawnHandle['done']>
        try {
          // `done` rejects for spawn-level failures; an abort-triggered
          // rejection is the timeout path and resolves as timedOut.
          outcome = await handle.done
        } catch (error) {
          if (controller.signal.aborted || opts.signal?.aborted === true) {
            return { exitCode: null, stdout: '', stderr: '', timedOut: true, stdoutLossy: false }
          }
          throw error
        }
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        const stdoutResolved = await resolveStdout(stdout)
        return {
          exitCode: outcome.exitCode,
          stdout: stdoutResolved.text,
          stderr: stderr?.text ?? '',
          timedOut: controller.signal.aborted || opts.signal?.aborted === true,
          stdoutLossy: stdoutResolved.lossy,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * Resolve the stdout text from a collect read: the in-memory tail, or — when
 * the read is lossy and the host spilled the complete stream to a file — the
 * spill file contents (so change COUNTS stay exact). A failed spill read
 * falls back to the tail and keeps `lossy: true` (head genuinely lost).
 */
async function resolveStdout(
  read: { readonly text: string; readonly lossy: boolean; readonly spillPath?: string } | undefined,
): Promise<{ readonly text: string; readonly lossy: boolean }> {
  if (read === undefined) return { text: '', lossy: false }
  if (!read.lossy || read.spillPath === undefined) return { text: read.text, lossy: read.lossy }
  try {
    return { text: await readFile(read.spillPath, 'utf8'), lossy: false }
  } catch {
    return { text: read.text, lossy: true }
  }
}
