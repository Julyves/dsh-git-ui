/**
 * Unified-diff text parser for the diff preview.
 *
 * Consumes the raw `git diff` / `git show` output and classifies every line
 * so the renderer can color it correctly (+ green, − red, @@ header,
 * context, meta). React-free and fully unit-testable.
 */

export type DiffLineType = 'meta' | 'hunk' | 'add' | 'del' | 'context'

export interface DiffLine {
  readonly type: DiffLineType
  readonly text: string
}

/**
 * Classify one line of unified diff output:
 *   `diff --git …` / `--- a/…` / `+++ b/…` (trailing space) / `index …` /
 *   `new file …` / `deleted file …` / `Binary files …`  → meta
 *   `@@ -a,b +c,d @@ …`         → hunk
 *   `+…` (any other plus line)  → add
 *   `-…` (any other minus line) → del
 *   ` …` (leading space)        → context
 *   anything else               → context (unknown lines render neutrally)
 */
export function classifyDiffLine(raw: string): DiffLineType {
  // File headers carry a trailing space (`+++ b/x`); a plus line without it
  // is content (`+++abc` = `+` marker + `++abc` content).
  if (/^(diff --git|index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity index |rename from |rename to |Binary files |GIT binary patch)/.test(raw)) return 'meta'
  if (raw.startsWith('@@ ')) return 'hunk'
  if (raw.startsWith('+')) return 'add'
  if (raw.startsWith('-')) return 'del'
  return 'context'
}

/**
 * Parse unified diff text into classified lines. Empty input yields an
 * empty array (the caller renders its own empty state).
 */
export function parseUnifiedDiff(text: string): readonly DiffLine[] {
  if (text === '') return []
  return text.split('\n').map((line) => ({ type: classifyDiffLine(line), text: line }))
}
