# Screenshot Placement Guide

This directory holds the screenshots of the plugin (session-header pill,
detail popover, Git center). The images are kept here so they can be
referenced from the READMEs, the npm package page, or GitHub release notes.
Each image uses the **exact filename** below — renaming breaks any reference
that already points at these paths.

## Required images

| File | Shows | Capture tips |
|---|---|---|
| `01-pill面板内容展示.png` | The branch pill + the detail popover it opens | Prefer a **dirty** state so the badges are visible (e.g. `⎇ main · +1 −1 ?2`). Keep the session title/context in frame; the pill is right-aligned in the header, with the popover opened below it. **The popover shows the repository root path — make sure it is not sensitive, or crop it.** |
| `02-面板选择切换分支.png` | The popover's inline branch switcher | Click the branch name in the popover header to open the switcher dropdown; show a local-branch list. |
| `03-Git中心统一阅览文件变更.png` | Git center — Changes tab | Grouped lists (staged / unstaged / untracked), bulk action buttons, the commit box, and the side-by-side diff for a selected file. Prefer a repo with a few staged + unstaged + untracked files so all three groups are visible. |
| `04-Git中心查看分支历史.png` | Git center — History tab (commit list + branch graph) | A repo with several commits across 2+ branches so the branch graph shows forks/merges; keep the filter tree on the left in frame. |
| `04-Git中心查看提交详情.png` | Git center — History tab (commit details) | Select a commit to show its subject · body · changed-file tree in the right pane. |

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
— the pill appears in the session header. For `01-pill面板内容展示.png`, click
the pill to open the popover.

## Sensitive-information rules

Never publish screenshots containing:

- absolute user paths (`/Users/<name>/...`), hostnames, usernames;
- tokens, API keys, or credentials;
- your real repository names/branches if you prefer to keep them private
  (the demo repo above avoids this entirely).

## After capturing

1. Save each file into this directory with the exact name from the table.
2. `git add docs/screenshots/ && git commit` — then reference the images
   wherever they are needed (`![alt](docs/screenshots/01-pill面板内容展示.png)`
   works on GitHub for repository-relative paths).
