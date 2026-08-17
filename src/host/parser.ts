/**
 * Pure parsers for the git porcelain/log output shapes used by the widget.
 * No side effects and no I/O — fully unit-testable against literal fixtures
 * (verified against real `git status --porcelain=v1 -z --branch` output).
 */
import type { GitChange, GitChangeStatus, GitCommit, GitRef, GraphCommit } from './types.ts'

/** Parsed status counts plus the (possibly capped) change list. */
export interface ParsedStatus {
  readonly branch: string | null
  readonly unborn: boolean
  readonly staged: number
  readonly modified: number
  readonly untracked: number
  readonly ahead: number
  readonly behind: number
  readonly changes: readonly GitChange[]
  readonly truncated: boolean
}

/** The NUL byte separating porcelain v1 -z entries. */
const NUL = '\u0000'
/** The unit separator used by the log --format payload. */
const LOG_SEP = '\u001f'

interface StatusHeader {
  readonly branch: string | null
  readonly unborn: boolean
  readonly ahead: number
  readonly behind: number
}

/**
 * Parse the `## ` header line of `git status --porcelain=v1 -z --branch`.
 * Recognized shapes (verified against git 2.x):
 *   `## main`
 *   `## main...origin/main`
 *   `## main...origin/main [ahead 1]`
 *   `## main...origin/main [behind 2]`
 *   `## main...origin/main [ahead 1, behind 2]`
 *   `## HEAD (no branch)`                 (detached)
 *   `## HEAD (detached at <hash>)`        (detached, older git)
 *   `## No commits yet on main`           (unborn)
 *   `## Initial commit on main`           (unborn, older git)
 */
export function parseStatusHeader(line: string): StatusHeader {
  const body = line.startsWith('## ') ? line.slice(3) : line
  if (body === '') return { branch: null, unborn: false, ahead: 0, behind: 0 }

  const unbornMatch = /^(?:No commits yet on|Initial commit on)\s+(.+)$/.exec(body)
  if (unbornMatch !== null) {
    return { branch: unbornMatch[1] ?? null, unborn: true, ahead: 0, behind: 0 }
  }

  const detached = /^HEAD(?:\s+\([^)]*\))?$/.exec(body)
  if (detached !== null) {
    return { branch: null, unborn: false, ahead: 0, behind: 0 }
  }

  const bracketMatch = /^(.*?)\s*\[([^\]]+)\]$/.exec(body)
  const core = bracketMatch?.[1] ?? body
  let ahead = 0
  let behind = 0
  if (bracketMatch?.[2] !== undefined) {
    for (const part of bracketMatch[2].split(',')) {
      const trimmed = part.trim()
      const aheadMatch = /^ahead (\d+)$/.exec(trimmed)
      const behindMatch = /^behind (\d+)$/.exec(trimmed)
      if (aheadMatch !== null) ahead = Number(aheadMatch[1])
      if (behindMatch !== null) behind = Number(behindMatch[1])
    }
  }
  // The core is `<branch>...<upstream>` — the branch never contains `...`.
  const branch = core.split('...', 1)[0] ?? core
  return { branch: branch === '' ? null : branch, unborn: false, ahead, behind }
}

/** Map one porcelain XY pair to a change status. */
function changeStatus(x: string, y: string): GitChangeStatus {
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'U' || y === 'U' || (x !== ' ' && y !== ' ')) return 'conflicted'
  switch (x) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'T': return 'typechange'
    case 'C': return 'added'
    default: return 'modified'
  }
}

/**
 * Parse the full `git status --porcelain=v1 -z --branch` output.
 * -z format: every entry (header and each `XY path`) is NUL-terminated; a
 * rename/copy entry emits `R  <new>\0<old>\0` so the following item is the
 * source path and must be consumed without becoming a change itself.
 */
export function parseStatusOutput(output: string, maxChanges: number): ParsedStatus {
  const raw = output.split(NUL)
  // Trailing NUL produces a final empty segment; drop it.
  const segments = raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw
  const header = parseStatusHeader(segments[0] ?? '')

  let staged = 0
  let modified = 0
  let untracked = 0
  const changes: GitChange[] = []
  let truncated = false

  for (let index = 1; index < segments.length; index += 1) {
    const entry = segments[index] ?? ''
    const x = entry[0] ?? ' '
    const y = entry[1] ?? ' '
    const path = entry.slice(3)
    if (x === ' ' && y === ' ') continue
    if (x === 'R' || x === 'C') {
      // -z: the source path is the next segment — consume it.
      index += 1
    }
    if (x === '?' && y === '?') {
      untracked += 1
    } else {
      if (x !== ' ' && x !== '?') staged += 1
      if (y !== ' ' && y !== '?') modified += 1
    }
    if (changes.length < maxChanges) {
      changes.push({ path, status: changeStatus(x, y), staged: x !== ' ' && x !== '?' })
    } else {
      truncated = true
    }
  }

  return {
    branch: header.branch,
    unborn: header.unborn,
    staged,
    modified,
    untracked,
    ahead: header.ahead,
    behind: header.behind,
    changes,
    truncated,
  }
}

/**
 * Parse `git log -n 5 --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI` output.
 * One commit per line, fields separated by the unit separator; empty output
 * (unborn repository) yields `[]`.
 */
export function parseLogOutput(output: string): readonly GitCommit[] {
  const commits: GitCommit[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, shortHash, subject, author, dateIso] = line.split(LOG_SEP)
    if (hash === undefined || hash === '') continue
    commits.push({
      hash,
      shortHash: shortHash ?? '',
      subject: subject ?? '',
      author: author ?? '',
      dateIso: dateIso ?? '',
    })
  }
  return commits
}

/**
 * 解析带图的 log 输出：
 * `%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D`
 * 其中 `%P` 为空格分隔的父提交哈希（根提交为空），`%D` 为 ref 装饰。
 * 返回适合分支图渲染器的 `GraphCommit[]`。
 */
export function parseGraphLogOutput(output: string, remotes: readonly string[] = []): readonly GraphCommit[] {
  const commits: GraphCommit[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, shortHash, subject, author, dateIso, parentField, decoField] = line.split(LOG_SEP)
    if (hash === undefined || hash === '') continue
    const parents = (parentField ?? '')
      .split(' ')
      .filter((p) => p !== '')
    commits.push({
      hash,
      shortHash: shortHash ?? '',
      subject: subject ?? '',
      author: author ?? '',
      dateIso: dateIso ?? '',
      parents,
      refs: parseDecorations(decoField ?? '', remotes),
    })
  }
  return commits
}

/**
 * 解析 `%D` 装饰串，形如 `HEAD -> main, origin/main, tag: v1.0`；空串无 refs。
 * 分类规则：`HEAD -> x` 为当前分支；`tag: t` 为标签；
 * 带远程前缀（`<remote>/…`）为远程分支；其余为本地分支。
 */
export function parseDecorations(decorations: string, remotes: readonly string[]): readonly GitRef[] {
  const trimmed = decorations.trim()
  if (trimmed === '') return []
  const refs: GitRef[] = []
  for (const token of trimmed.split(', ')) {
    if (token.startsWith('HEAD -> ')) {
      refs.push({ kind: 'branch', name: token.slice(8), head: true })
    } else if (token.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: token.slice(5), head: false })
    } else if (remotes.some((remote) => token === remote || token.startsWith(`${remote}/`))) {
      refs.push({ kind: 'remote', name: token, head: false })
    } else {
      refs.push({ kind: 'branch', name: token, head: false })
    }
  }
  return refs
}

/**
 * 解析 `git show -s --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%B` 输出：
 * 前五个字段为机器可读元数据，第六字段起为 %B 原始报文
 * （首行即 subject，其后空行 + 正文）。
 */
export function parseShowMeta(output: string): { readonly commit: GitCommit; readonly body: string } | null {
  const trimmed = output.trimEnd()
  if (trimmed === '') return null
  const [hash, shortHash, subject, author, dateIso, ...bodyParts] = trimmed.split(LOG_SEP)
  if (hash === undefined || hash === '') return null
  const bodyLines = bodyParts.join(LOG_SEP).split('\n')
  // %B 首行即 subject 行：去掉它与随后空行，余下为正文。
  let start = 1
  while (start < bodyLines.length && (bodyLines[start] ?? '').trim() === '') start += 1
  return {
    commit: {
      hash,
      shortHash: shortHash ?? '',
      subject: subject ?? '',
      author: author ?? '',
      dateIso: dateIso ?? '',
    },
    body: bodyLines.slice(start).join('\n').trimEnd(),
  }
}

/**
 * Parse `git branch --show-current` output: the branch name, or null when
 * empty (detached HEAD).
 */
export function parseBranchOutput(output: string): string | null {
  const trimmed = output.trim()
  return trimmed === '' ? null : trimmed
}

/** One parsed `git show --stat` row (path plus +/- change counts). */
export interface StatRow {
  readonly path: string
  readonly added: number
  readonly deleted: number
}

/**
 * Parse the stat block of `git show <ref> --stat`:
 *   ` path | 3 ++-` / ` path | Bin 0 -> 12 bytes` / `N files changed, ...`
 * Paths with spaces are quoted (`"a b.txt" | 2 +`); binary rows and summary
 * lines are skipped. Only `path | N <marks>` rows are kept.
 */
export function parseStatOutput(output: string): readonly StatRow[] {
  const rows: StatRow[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    const separator = line.indexOf(' | ')
    if (separator <= 0) continue
    const pathPart = line.slice(0, separator)
    const rest = line.slice(separator + 3)
    if (rest === '') continue
    // ` Bin 0 -> 12 bytes` — binary change, no +/- marks to count.
    if (rest.startsWith('Bin')) continue
    const match = /^(\d+)\s+([+-]+)$/.exec(rest)
    if (match === null) continue
    let path = pathPart
    if (path.startsWith('"') && path.endsWith('"')) {
      // git quotes paths containing special characters (C-style escapes).
      path = path.slice(1, -1).replace(/\\(.)/g, '$1')
    }
    const marks = match[2] ?? ''
    let added = 0
    let deleted = 0
    for (const mark of marks) {
      if (mark === '+') added += 1
      else if (mark === '-') deleted += 1
    }
    rows.push({ path, added, deleted })
  }
  return rows
}
