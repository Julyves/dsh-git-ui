/**
 * Git command execution adapter over the host subprocess service.
 *
 * The widget only needs a tiny slice of the subprocess contract; declaring it
 * structurally here (instead of depending on the npm package, whose registry
 * chain is incomplete) keeps the plugin buildable standalone while remaining
 * wire-compatible with the host's `subprocess` service.
 */

/** One collected stream disposition (matches the host SubprocessCollect). */
interface CollectDisposition {
  readonly collect: { readonly maxBytes: number }
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
    readonly stdout?: { readFrom(fromByte: number): { readonly text: string; readonly lossy: boolean } }
    readonly stderr?: { readFrom(fromByte: number): { readonly text: string; readonly lossy: boolean } }
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
  /** True when the run was killed by our timeout. */
  readonly timedOut: boolean
  /** True when the collected stdout overflowed its byte cap (head lost). */
  readonly stdoutLossy: boolean
}

/** The run primitive the snapshot orchestration uses. */
export interface GitRunner {
  run(argv: readonly string[], opts: { readonly cwd: string }): Promise<GitRunResult>
}

/**
 * Adapt the host subprocess service into a `GitRunner` with a per-command
 * timeout. A timed-out run resolves (never rejects) with `timedOut: true`;
 * only spawn-level failures (e.g. git not installed) reject.
 */
export function createGitRunner(subprocess: SubprocessLike, timeoutMs: number, maxBytes: number): GitRunner {
  return {
    async run(argv, opts) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const handle = subprocess.spawn({
          argv,
          cwd: opts.cwd,
          stdio: {
            stdout: { collect: { maxBytes } },
            stderr: { collect: { maxBytes } },
          },
          graceMs: 200,
          signal: controller.signal,
        })
        let outcome: Awaited<SpawnHandle['done']>
        try {
          // `done` rejects for spawn-level failures; an abort-triggered
          // rejection is the timeout path and resolves as timedOut.
          outcome = await handle.done
        } catch (error) {
          if (controller.signal.aborted) {
            return { exitCode: null, stdout: '', stderr: '', timedOut: true, stdoutLossy: false }
          }
          throw error
        }
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        return {
          exitCode: outcome.exitCode,
          stdout: stdout?.text ?? '',
          stderr: stderr?.text ?? '',
          timedOut: controller.signal.aborted,
          stdoutLossy: stdout?.lossy === true,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
