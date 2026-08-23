/**
 * 事故排查:对真实构建产物 lib/host/index.js 做宿主装配冒烟测试。
 * 用最小 stub ctx 实例化 GitStatusService(真实 git subprocess + 伪造会话),
 * 验证:构造不挂起、snapshot/run/query(turn-records)全链路无异常、无未捕获 rejection。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const { GitStatusService } = await import(join(ROOT, 'lib/host/index.js'))

/** 真实 git 子进程适配(collect 模式)。 */
function realSubprocess() {
  return {
    spawn(spec) {
      let stdout = ''
      let stderr = ''
      const child = spawn(spec.argv[0] ?? 'git', spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], signal: spec.signal })
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (c) => { stdout += c })
      child.stderr?.on('data', (c) => { stderr += c })
      const done = new Promise((resolve, reject) => {
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

function git(dir, ...args) {
  const r = spawnSyncGit(dir, args)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}
import { spawnSync } from 'node:child_process'
function spawnSyncGit(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ── 造一个真实 git 仓库 + 会话事件 ──────────────────────────────────────
const dir = await mkdtemp(join(tmpdir(), 'dsh-git-ui-smoke-'))
await mkdir(dir, { recursive: true })
git(dir, 'init', '-b', 'main')
git(dir, 'config', 'user.email', 't@t')
git(dir, 'config', 'user.name', 'T')
await writeFile(join(dir, 'readme.txt'), 'hello\n')
git(dir, 'add', '.')
git(dir, 'commit', '-m', 'init')
await writeFile(join(dir, 'docs.txt'), 'agent wrote this\n')

const sequence = { next: 0 }
function ev(type, time, data = {}) {
  return { type, seq: ++sequence.next, time, data }
}

/** 伪造会话:含 turn/start、tool/call(write)、tool/result(meta)、turn/end。 */
const sessionEvents = [
  ev('turn/start', 1000, { turn: 1 }),
  ev('tool/call', 1100, { turn: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'docs.txt', content: 'x' }) }),
  ev('tool/result', 1200, { turn: 1, callId: 'c1', meta: { diffs: [{ path: 'docs.txt', oldText: null, newText: 'x' }] } }),
  ev('turn/end', 2000, { turn: 1 }),
]
const sessionRecord = {
  id: 'session-smoke-1',
  events: sessionEvents,
  seq: sessionEvents.length,
  header: { cwd: dir },
}
const header = { cwd: dir }

// ── 最小 ctx stub ────────────────────────────────────────────────────────
function stubContext() {
  const listeners = new Map()
  return {
    get(name) {
      switch (name) {
        case 'subprocess': return realSubprocess()
        case 'sessions': return {
          get: (id) => id === sessionRecord.id ? sessionRecord : undefined,
          list: () => [], // 无 subagent
          reflect: undefined,
        }
        case 'sessionPersistence': return {
          inspect: async () => ({ meta: header }),
        }
        case 'tools': return {
          get: (name) => {
            // 模拟 write 工具的 presentCall
            if (name === 'write' || name === 'edit') {
              return {
                presentCall: (args) => ({
                  card: 'diff',
                  diffs: [{ path: args.file_path, oldText: null, newText: '' }],
                  locations: [{ path: args.file_path }],
                }),
              }
            }
            return undefined
          },
        }
        default: return undefined
      }
    },
    inject() {},
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    effect() {},
    plugin() { return Promise.resolve({ dispose: async () => {} }) },
    reflect: { props: {}, provide() {} },
  }
}

const ctx = stubContext()
/** git 命令调用计数(验证快照缓存语义)。 */
let gitSpawns = 0
const originalSpawn = ctx.get('subprocess').spawn
ctx.get('subprocess').spawn = function (spec) {
  gitSpawns += 1
  return originalSpawn.call(this, spec)
}
let service
try {
  service = new GitStatusService(ctx, {})
  console.log('[smoke] constructor OK')
} catch (error) {
  console.error('[smoke] CONSTRUCTOR FAILED:', error)
  process.exit(1)
}

// Google: 阈值内等待(构造期无异步,直接跑)
const request = { sessionId: sessionRecord.id }

// 1. snapshot(带 track)
const snapshotStart = Date.now()
const snapshotResult = await service.snapshot(request)
console.log(`[smoke] snapshot ok=${snapshotResult.ok} ms=${Date.now() - snapshotStart}`)
if (!snapshotResult.ok) throw new Error(`snapshot failed: ${JSON.stringify(snapshotResult.error)}`)

// 2. turn-records 查询(快照缓存:首次无缓存 → 内部跑一次 snapshot)
const gitSpawnsAfterSnapshot = gitSpawns
const recordsStart = Date.now()
const recordsResult = await service.query({ sessionId: sessionRecord.id, query: { kind: 'turn-records' } })
console.log(`[smoke] turn-records ok=${recordsResult.ok} ms=${Date.now() - recordsStart} gitSpawns=${gitSpawns - gitSpawnsAfterSnapshot}`)
if (!recordsResult.ok) throw new Error(`turn-records failed: ${JSON.stringify(recordsResult.error)}`)
if (recordsResult.value.kind !== 'turn-records') throw new Error('unexpected result kind')
const turn = recordsResult.value.turns[0]
console.log(`[smoke] turns=${recordsResult.value.turns.length} internal=${JSON.stringify(turn?.internal.map((e) => e.path))} external=${JSON.stringify(turn?.external.map((e) => e.path))}`)
if (!turn?.internal.some((e) => e.path === 'docs.txt')) {
  console.error('[smoke] EXPECTED docs.txt as internal, got:', JSON.stringify(turn?.internal))
  process.exit(1)
}

// 3. 再次查询(增量幂等 + 快照缓存命中 → 不再 spawn git)
const beforeSecond = gitSpawns
const again = await service.query({ sessionId: sessionRecord.id, query: { kind: 'turn-records' } })
console.log(`[smoke] second turn-records ok=${again.ok} turns=${again.value.turns.length} gitSpawnsDelta=${gitSpawns - beforeSecond}`)
if (gitSpawns - beforeSecond !== 0) {
  console.error('[smoke] EXPECTED cached snapshot (zero git spawns on second query)')
  process.exit(1)
}

// 4. run 操作(stage)
const runResult = await service.run({ sessionId: sessionRecord.id, action: { kind: 'stage', paths: ['docs.txt'] } })
console.log(`[smoke] run stage ok=${runResult.ok}`)

// 5. 不存在的会话 → 降级
const missing = await service.query({ sessionId: 'nope', query: { kind: 'turn-records' } })
console.log(`[smoke] unknown session -> ok=${missing.ok} code=${missing.error?.code}`)

// 6. 未捕获 rejection 检查
const warnings = []
process.on('unhandledRejection', (reason) => warnings.push(reason))
await new Promise((resolve) => setTimeout(resolve, 500))
console.log(`[smoke] unhandledRejections: ${warnings.length}`)
if (warnings.length > 0) {
  console.error('[smoke] UNHANDLED REJECTIONS:', warnings)
  process.exit(1)
}

// 清理
await rm(dir, { recursive: true, force: true })
console.log('[smoke] ALL OK')
process.exit(0)