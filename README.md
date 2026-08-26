# dsh-git-ui

[![npm version](https://img.shields.io/npm/v/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)
[![npm license](https://img.shields.io/npm/l/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)
[![npm downloads](https://img.shields.io/npm/dm/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that visualizes Git status in the Web UI — the session-header pill shows the current branch (or detached HEAD) and dirty-state counts (staged / modified / untracked) with ahead/behind at a glance. Click for recent commits and changed files, or open the Git center for full management. No terminal needed.

> Read this in [简体中文](README.zh.md).

- 📦 **npm**: <https://www.npmjs.com/package/dsh-git-ui>
- 🐙 **GitHub**: <https://github.com/Julyves/dsh-git-ui>
- 🐛 **Issues**: <https://github.com/Julyves/dsh-git-ui/issues>

## Features

### Branch pill in the session header

A status capsule on the right of each session header: a status dot (green when clean, orange when dirty), the branch name, and dirty / ahead-behind badges — click to open the detail popover:

<img src="docs/screenshots/01-pill面板内容展示.png" alt="Branch pill and the detail popover it opens" width="720">

| State | Pill |
|---|---|
| Clean | `● main` |
| Dirty | `● main · +2 −1 ?3` |
| Ahead / behind | `● main · ↑1 ↓2` |
| Detached HEAD | `● (detached HEAD) · a1b2c3d` |
| Unborn (no commits) | `● main · 无提交` |
| Not a git repo | Dimmed `无 Git 仓库` |
| Git unavailable / error | Dimmed `Git 不可用` (reason in tooltip) |

`+N −N ?N` = staged / modified / untracked; `↑N ↓N` = ahead / behind. When both dirty and ahead/behind, the badges combine (e.g. `● main · +2 −1 ?3 · ↑1 ↓2`).

### Detail popover

Clicking the pill opens: the repository root path, status counts with dirty and ahead/behind badges, recent commits (hash · subject · author · relative time — click a commit to jump to the History tab with it located and selected), the changed-file list with status chips and inline per-file actions (stage / unstage / discard), an inline branch switcher, a manual refresh button, and the last-checked time:

<img src="docs/screenshots/02-面板选择切换分支.png" alt="Inline branch switching in the detail popover" width="720">

### Git center

The full management panel, opened from the popover — four tabs: **Changes**, **History**, **Records** and **Settings**.

#### Changes

IDE-style grouped lists (staged / unstaged / untracked), per-file and bulk stage / unstage / discard (two-step confirm), a commit box (selected files or everything staged), and an inline side-by-side diff for the selected file with prev/next navigation:

<img src="docs/screenshots/03-Git中心统一阅览文件变更.png" alt="Git center — Changes tab (grouped file changes)" width="720">

#### History

A paginated commit list with a rendered branch graph, filters by branch / tag / author / date / text-or-hash, a fetch-remote button, and per-commit details:

<img src="docs/screenshots/04-Git中心查看分支历史.png" alt="Git center — History tab (commit list with branch graph)" width="720">

Selecting a commit shows its subject · body · changed-file tree (foldable directories) in the detail pane:

<img src="docs/screenshots/04-Git中心查看提交详情.png" alt="Git center — commit details and changed-file tree" width="720">

#### Records

The turn work-record session timeline — see [Turn work records](#turn-work-records) below:

<img src="docs/screenshots/05-Git中心查看Turn记录.png" alt="Git center — Records tab (turn work-record session timeline)" width="720">

#### Settings

Configurable pill information components and diff-viewer options: a live preview, four display presets (minimal / standard / full / custom — purely derived, so any manual tweak snaps back when it matches a preset again), and per-component switches (status dot, branch name, the three change-count badges, ahead/behind; plus popup blocks: repository path, status bar, branch switcher, new-branch row, recent-commit count, changed-file list). **Popup section order**: reorder the popup's content sections with up/down arrows (hidden sections stay in the sequence and appear at their position when enabled; ordering is independent of the display presets). A diff-viewer group (code font size, syntax highlighting, context folding) follows. Also reachable via the gear icon in the popup header:

<img src="docs/screenshots/06-Git中心管理插件设置.png" alt="Git center — Settings tab (display presets and switches)" width="720">

### Turn work records

Answer "**what did this round of work touch, and who touched it**" with per-turn attribution of filesystem changes — strictly git-based (ignored / out-of-repo files never count).

- **Single-turn mode (pill, default)**: a compact badge for the latest working period — an incremental unread count first (`new N` since your last view, cleared on view), then three-way authorship counts: `本` this session's agent (subagents included) / `会` AI of other dsh sessions in the same workspace / `外` human (IDE / terminal / unknown). Click the pill for the grouped file lists and the task narrative; a Settings switch hides the badge.
- **All-session mode (Records tab)**: consecutive working turns are merged into **working periods** (default: gaps ≤ 10 min). Each period card carries the **task narrative** (the user instruction driving that period — "what" before "when"), its time window, and three-way counts; expanding reveals three file groups (this session / other sessions / external) with state badges (still dirty / committed / reverted / gone). The toolbar offers a summary (periods · files · still-dirty) and a four-way filter. **Every period is expandable** — periods that produced no file changes dim the header with a `无变更产出` chip and show an empty state when opened, so "did this turn touch anything?" is answered at a glance.
- **Three-way authorship**: `this session` (agent + delegated subagents) / `other sessions` (AI writes from other dsh sessions in the same workspace) / `external` (human: IDE, terminal, unidentified) — the attribution axis matches the user's mental model: "AI changed it" and "I changed it" no longer share one bucket. Sibling-session attribution is frozen into the observation timeline, so it never drifts after the sibling session leaves or the host restarts.
- **Action loop**: each period card offers **bulk staging** — "Stage AI changes" (this + other sessions' still-dirty files, human WIP excluded) and "Stage all"; **committed entries deep-link to the exact commit** in the History tab (auto-located and selected).
- **Attribution confidence + manual correction**: entries backed by platform-declared write intent get a solid badge; heuristic ones get a dashed badge with `≈` — the uncertainty stays visible. Hover an entry and press `⇄` to reclassify its authorship (repository-scoped, persisted to disk; applied uniformly across the popup, the Records tab and the unread count).
- **New-output marking**: each turn's boundary is captured in a fingerprint; entries absent from the *previous* turn's boundary are marked `新`, so this round's new output is distinguishable from the existing history at a glance.

How it works: the host folds the session event log (`turn/start` · `turn/end` · `tool/call` · `user/message` carry timestamps) into exact per-turn windows plus task narratives; agent-written paths are extracted by reusing each tool's declared write intent (bash falls back to a static-target heuristic: redirects / tee / sed -i / cp-mv / dd of=); sibling writes are merged by enumerating same-cwd sessions; external changes are attributed through a polling observation timeline (first-seen per path + HEAD-move commit detection + mtime refinement for still-dirty files). The observation timeline, narratives and fingerprints persist under the host plugin-data directory, so records survive host restarts.

### Polished diff viewer

Side-by-side diff in the Changes tab:

- **View modes + Markdown rendering**: a segmented control in the diff toolbar switches between **Split** (before/after side by side — the default), **Before** and **After** — the single-side modes render the full pre- or post-change content in one full-width column with no gaps. In split mode the divider between the columns is draggable to adjust the ratio (20%–80%); the choice stays for the session. **Markdown files (.md/.markdown) get an extra "Rendered" mode**: the post-change content rendered as formatted Markdown (headings, lists, quotes, tables, highlighted fenced code — via a zero-dependency, safe renderer: raw HTML is escaped and link schemes are whitelisted).
- **New / deleted files shown directly**: a pure-add diff (`--- /dev/null` shape) renders the created file's full content in a single column with line numbers instead of an empty comparison — and a pure-delete diff (`+++ /dev/null`) symmetrically renders the deleted file's full content with a "Deleted" badge; 0-byte files show "file is empty".
- **Syntax highlighting**: keyword / string / comment / number coloring per file type; the whole file is tokenized once and rendered line-by-line, so multi-line comments and strings stay correct. Colors reuse the host theme tokens (auto light/dark); the highlight switch and code font size are configurable.
- **Context folding**: runs of 12+ unchanged lines collapse into an expandable "… N unchanged lines" strip (click to expand/collapse); can be disabled in settings. Folding works in all view modes (coordinates are computed per stream).
- **Settings**: code font size (10–16px), syntax-highlight switch and context-folding switch live in a diff-viewer group, independent of the display presets.

### Fresh data & graceful degradation

- **Always fresh, zero interaction**: a status snapshot loads automatically on session open; silent polling (host-configured interval, default 30s, no overlapping requests); an **immediate refresh when an agent turn completes** (the working tree most likely changed right then); resync after reconnect; and a manual refresh button.
- **Deterministic degradation**: non-git directories, missing cwd, missing git, timeouts and oversized repositories show stable fallback states — never crashes, never spams.
- **Zero agent impact**: adds no model tools and writes no session events — it never changes agent behavior. Git operations in the center (stage / commit / branch / fetch) are user-initiated from the UI, never agent-driven.

## Installation

Requires a running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) with the `web` profile.

```sh
# Install from the npm registry.
dsh plugin --profile web add dsh-git-ui
```

Restart dsh web. Open a session in a git repository and the branch pill appears in the session header.

To verify the install:

```sh
cat ~/.dsh/profiles/web/package.json   # dsh.profile.bundles should list dsh-git-ui
```

To remove:

```sh
dsh plugin --profile web remove dsh-git-ui
```

> Local development install (links this repo into the profile instead):
> `dsh plugin --profile web add ./`. Local tarball / link installs
> (`file:...tgz`, `github:...`) symlink the package outside the profile tree,
> so its `@deepseek-ai/*` peer dependencies (provided by the host
> installation) are not reachable by Node's resolution. Keep the dev peer
> symlinks in this repo's `node_modules/@deepseek-ai/*`
> (see [Development](#development)) whenever installing locally.

## Usage

1. Open a session whose working directory is inside a git repository.
2. Read the branch pill in the header at any time — no action needed.
3. Click the pill to inspect repository root, counts, recent commits, and changed files; use `刷新` (refresh) for an immediate re-check, or open the Git center for full change management and history.

Each session shows the Git status of **its own working directory**. Non-repository sessions show a dimmed placeholder instead of the pill.

## Configuration (optional)

All defaults work out of the box. Advanced users may override the plugin config in the profile's `cordis.patch.yml` (a later layer wins; the row replaces the whole `config`):

```yaml
- id: git-ui
  config:
    defaultRefreshIntervalMs: 60000   # polling interval (ms); 0 disables polling
    maxChanges: 200                   # max changed-file entries in a snapshot
    timeoutMs: 3000                   # per git-command timeout (ms)
    maxStatusBytes: 8388608           # status-output cap before truncation
    dshHome: /path/to/harness-home    # optional: Harness home (default $DSH_HOME → ~/.dsh)
                                      # plugin data lives under <home>/plugin-data/dsh-git-ui/
```

## Requirements

- Node.js `^22.19.0 || >=24.0.0`
- dsh `>= 0.1.0-rc` (developer preview)
- `git` on the host machine (the plugin shells out to `git`)

## Known Limitations

- Shows the Git state of the session's working directory only. The History filter tree lists remote branches with ahead/behind and a manual fetch, but push / pull / merge are not exposed.
- Polling-based refresh (default 30s); file-watcher event push is a planned extension.
- Changed-file list is capped (`maxChanges`); untracked-directory contents are enumerated individually. When status output overflows the in-memory cap (default 4 MiB) it is recovered from a private spill file so counts stay exact — only if the spill cap (64 MiB) also overflows does the snapshot fall back to approximate (`truncated: true`).
- Browser never sends paths — only a `sessionId`; the host resolves the authoritative cwd and runs git commands (write operations use `--` path separation and reject absolute / `..` escapes).
- **Turn work records**: bash writes with dynamically-constructed targets (`$(...)`, globs, `find -exec`, `eval`) are not statically extractable and fall back to external with a visible `≈` inferred mark (a per-turn authoritative write set from the upstream sandbox would bypass the heuristic pipeline entirely); cold (unloaded) subagent / sibling sessions are skipped for their attribution — sibling attribution is frozen into the observation timeline (already-judged entries never drift after the session leaves or the host restarts), but sibling writes never judged by any query still land in external; sibling-session detection resolves cwd through realpath and includes subdirectories of the repo; the observation timeline is capped (2,000 paths/session, oldest pruned) and external changes that appear and vanish within one poll interval cannot be reconstructed after a host restart; turn-boundary fingerprints approximate the boundary at first observation (write-then-revert within one poll interval is indistinguishable); changes predating the first turn have no owning window; manual authorship overrides are repository-scoped (they outlive sessions and are never garbage-collected with them).
- Syntax highlighting ships a bundle-budget language subset (TypeScript/JS family, JSON/YAML/TOML/INI, Markdown, XML/HTML, CSS/SCSS/LESS, Python, Shell, Java, Go, Rust, C, C#, Kotlin, SQL, Makefile). C++ is approximated with the C grammar, HTML with XML, and SCSS/LESS with CSS (core tokens correct; language-specific constructs fall back to plain text); unregistered languages such as PHP, Swift, Ruby and Lua fall back to plain text wholesale (still monospace, never an error).
- Settings persist on the host disk; if the host RPC is unreachable (degraded mode), settings stay in memory only (valid for the session).

## Development

```sh
pnpm install
# Link the host-provided peers into the repo so a local profile install
# (`dsh plugin --profile web add ./`) resolves them: pnpm symlinks the
# package into the profile, and Node follows the realpath back into this
# repo, so `node_modules/@deepseek-ai/*` must point at the host fallback.
mkdir -p node_modules/@deepseek-ai
for p in "$HOME"/.dsh/profiles/node_modules/@deepseek-ai/*; do
  ln -sfn "$p" "node_modules/@deepseek-ai/$(basename "$p")"
done
pnpm run typecheck
pnpm test
pnpm run build        # host (esbuild ESM, never minified) + client (ModuleLoader factory closure)
dsh plugin --profile web add ./   # local install; restart dsh web to verify
```

### Architecture

The plugin is layered to isolate the dsh platform behind a narrow adapter seam,
so business logic stays untouched when dsh APIs evolve:

```mermaid
flowchart TB
    subgraph Biz["Business Layer — zero dsh imports"]
        HostBiz["src/host/ · core / actions / queries / parser"]
        ClientBiz["src/client/ · controller / GitPill / GitCenter"]
    end
    subgraph Contracts["Contracts Layer — stable interfaces"]
        C["src/contracts/ · host-endpoints / client-platform / ui-primitives"]
    end
    subgraph Adapters["Adapters Layer — the only dsh-aware code"]
        A["src/adapters/dsh/ · client-adapter / ui-primitives / types"]
    end
    HostBiz --> C
    ClientBiz --> C
    C --> A
    A --> DSH["dsh platform · cordis / typert / ui-primitives"]
```

- `src/contracts/` defines the plugin's own stable interfaces (no dsh imports).
- `src/host/` and `src/client/` implement business logic against those interfaces.
- `src/adapters/dsh/` is the **only** place that imports `@deepseek-ai/*`;
  a dsh upgrade only requires changes here.

## License

[MIT](LICENSE)