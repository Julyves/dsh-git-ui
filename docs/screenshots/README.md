# Screenshot Placement Guide

This directory holds the screenshots of the plugin (session-header pill,
detail popup, degraded states). The images are kept here so they can be
referenced from the READMEs, the npm package page, or GitHub release notes.
Each image uses the **exact filename** below — renaming breaks any reference
that already points at these paths.

## Required images

| File | Shows | Capture tips |
|---|---|---|
| `pill.png` | The branch pill in a session header | Prefer a **dirty** state so the badges are visible (e.g. `⎇ main · +1 −1 ?2`). Keep the session title/context in frame; the pill is right-aligned in the header. |
| `popup.png` | The detail panel opened by clicking the pill | Count grid (staged / modified / untracked / ahead / behind), recent commits, changed-file list. **The panel shows the repository root path — make sure it is not sensitive, or crop it.** |
| `dirty.png` | State comparison: clean vs dirty vs non-repository | Two or three pills side by side, or the dimmed `无 Git 仓库` placeholder. Optional — remove the README paragraph if omitted. |

## File rules

- Format: **PNG**.
- Width: **1000–1280 px** recommended (GitHub README renders at roughly
  800 px; wider images get scaled down, smaller ones look soft).
- Height: whatever fits the content; crop tightly (macOS: `Cmd+Shift+4`
  region select, `Cmd+Shift+5` window capture).
- One image per file, no compositing tools required.

## Capturing against a demo repo

A throwaway repo keeps the shots clean and free of your real work:

```sh
mkdir -p /tmp/dsh-git-ui-demo && cd /tmp/dsh-git-ui-demo
git init -b main
echo hello > readme.txt && git add . && git commit -m "initial commit"
echo change >> readme.txt          # modified
git add readme.txt                 # staged
touch new.txt                      # untracked
```

Then open a dsh web session whose working directory is `/tmp/dsh-git-ui-demo`
— the pill appears in the session header. For `popup.png`, click the pill.

## Sensitive-information rules

Never publish screenshots containing:

- absolute user paths (`/Users/<name>/...`), hostnames, usernames;
- tokens, API keys, or credentials;
- your real repository names/branches if you prefer to keep them private
  (the demo repo above avoids this entirely).

## After capturing

1. Save each file into this directory with the exact name from the table.
2. `git add docs/screenshots/ && git commit` — then reference the images
   wherever they are needed (`![alt](docs/screenshots/pill.png)` works on
   GitHub for repository-relative paths).
