# dsh-git-status

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that visualizes Git status in the Web UI: current branch, HEAD, dirty-state counts (staged / modified / untracked), ahead/behind, recent commits, and changed files — right in the session header, no terminal needed.

> Read this in [简体中文](README.zh.md).

## Features

- **Branch pill** in the session header (right-aligned, per-session): shows the current branch at a glance, with dirty-state and ahead/behind indicators:

  | State | Pill |
  |---|---|
  | Clean | `⎇ main` |
  | Dirty | `⎇ main · +2 −1 ?3` (staged / modified / untracked) |
  | Ahead / behind | `⎇ main ↑1 ↓2` |
  | Detached HEAD | `⎇ (detached) · a1b2c3d` |
  | Unborn (no commits) | `⎇ main · 无提交` |
  | Not a git repo | Dimmed `无 Git 仓库` |
  | Git unavailable / error | Dimmed `Git 不可用` (reason in tooltip) |

- **Detail popover** (click the pill): repository root, count grid (staged / modified / untracked / ahead / behind), recent commits (hash · subject · author · relative time), changed-file list with status chips, manual refresh button, and last-checked time.
- **Always-fresh data, zero interaction**: automatic fetch on session open, silent polling (host-configured interval, default 30s, no overlapping requests), resync after reconnect, and a manual refresh button.
- **Deterministic degradation**: non-git directories, missing cwd, missing git, timeouts, and oversized repositories show stable fallback states — never crashes, never spams.
- **Pure read-only UI**: no new model tools, no session events, no impact on agent behavior.

## Installation

Requires a running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) with the `web` profile.

```sh
# From npm (recommended — the plugin's runtime dependencies resolve through
# the host installation's module fallback)
dsh plugin --profile web add dsh-git-status
```

Restart dsh web. Open a session in a git repository and the branch pill appears in the session header.

> Local tarball / link installs (`file:...tgz`, `github:...`) symlink the
> package outside the profile tree, so its `@deepseek-ai/*` peer dependencies
> (provided by the host installation) are not reachable by Node's resolution.
> Use the npm route for end users; see [Development](#development) for the
> local-link setup used while developing this repo.

To verify the install:

```sh
cat ~/.dsh/profiles/web/package.json   # dsh.profile.bundles should list dsh-git-status
```

To remove:

```sh
dsh plugin --profile web remove dsh-git-status
```

## Usage

1. Open a session whose working directory is inside a git repository.
2. Read the branch pill in the header at any time — no action needed.
3. Click the pill to inspect repository root, counts, recent commits, and changed files; use `刷新` (refresh) for an immediate re-check.

Each session shows the Git status of **its own working directory**. Non-repository sessions show a dimmed placeholder instead of the pill.

## Configuration (optional)

All defaults work out of the box. Advanced users may override the plugin config in the profile's `cordis.patch.yml` (a later layer wins; the row replaces the whole `config`):

```yaml
- id: git-status
  config:
    defaultRefreshIntervalMs: 60000   # polling interval (ms); 0 disables polling
    maxChanges: 200                   # max changed-file entries in a snapshot
    timeoutMs: 3000                   # per git-command timeout (ms)
    maxStatusBytes: 8388608           # status-output cap before truncation
```

## Requirements

- Node.js `^22.19.0 || >=24.0.0`
- dsh `>= 0.1.0-rc` (developer preview)
- `git` on the host machine (the plugin shells out to `git`)

## Known Limitations

- Shows the Git state of the session's working directory only (no remote URL / push-branch names yet).
- Polling-based refresh (default 30s); file-watcher event push is a planned extension.
- Changed-file list is capped (`maxChanges`); oversized status output is truncated (`truncated: true`) with approximate counts.
- Browser never sends paths — only a `sessionId`; the host resolves the authoritative cwd and runs read-only git commands.

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

See [PLAN.md](PLAN.md) for the architecture research and engineering decisions.

## License

[MIT](LICENSE)
