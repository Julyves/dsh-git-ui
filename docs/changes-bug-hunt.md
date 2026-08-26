# 变更（Changes）界面前后端 Bug 狩猎报告

> 分支 `fix/bug-hunt` · 2026-08-26 · 基线 `56d0e2c`（含第一轮 history 七项修复）
> **状态：五项已全部修复（见文末「修复记录」），复现测试转为回归锁。**
> 范围：Git 中心 Changes 标签的完整数据链路 ——
> host 侧 `actions.ts`（stage/unstage/discard/commit 动作序列）+
> `queries.ts` 的 `diffQuery` → client 侧 `ChangesTab.tsx` / `ChangeRow.tsx` /
> `changes-diff.ts`（选择态协调）/ `side-by-side.ts`（diff 解析）/ `DiffSideBySide.tsx`
> （并排渲染）/ `new-file-view.tsx` / `use-window-slice.ts`（窗口化）。

## 方法

与第一轮（history，见 `docs/history-bug-hunt.md`）相同：

1. 通读全部相关源文件（约 1,900 行），列出候选缺陷；
2. 真实临时仓库 + 真实 git 命令验证 host 侧行为（C-D/C-E 及 C-A 的影响链）；
3. jsdom + createRoot 交互式组件测试验证 client 侧行为（C-A/C-B/C-C），
   复现测试入库（`it.fails` / confirming 形态）；
4. 证伪与降级：设计文档明示的行为（如 MM 双条目复选框联动）不计 bug。

复现测试文件：`tests/client/changes-stale-select.spec.tsx`（C-A、C-C 为
expected-fail，C-B 为 confirming）。

全量套件状态：**46 文件 / 537 通过 / 2 expected-fail**，typecheck 通过。

---

## BUG-C1（高）选择集从不随快照修剪——失效路径使「提交所选」永久卡死

**位置**：`src/client/center/changes/ChangesTab.tsx`
- `selected` 状态（L33）只在勾选/组选/成功提交时变更，**无任何随
  `snapshot.changes` 修剪的逻辑**（对照：diff 选择有 `reconcileDiffSelection`）。

**机理**：本插件的使用场景里，工作区被 AI agent 持续改动、快照每 30s 轮询刷新。
用户勾选文件 → agent 恢复（tracked 修改消失）或删除（untracked 文件消失）→
该路径从变更清单消失、**行不再渲染，用户无法反选**——但路径仍留在 `selected`。
此后每次「提交所选」都把失效路径发给 host：

```
git add -- <失效路径> …     → fatal: pathspec … did not match（exit 128）
```

`runAction` 的命令序列**遇错中止**（已实测）：其余有效选择的提交一并失败。
且因 GitCenter 三标签以 `display:none` 保持挂载，`selected` 状态跨开关长期存活
——**在用户重新打开/切换会话前，「提交所选」功能永久不可用**，错误信息只有
git 原始 pathspec 报错，无从定位。提交框上方的「提交所选 N 个文件」计数也
持续虚高。

**验证**：
- jsdom（C-A）：勾选 `b.txt` → 快照更新移除该行 → 提交 →
  commit 动作 `paths:["b.txt"]` 仍携带失效路径；
- 真实 git：`git add -- u.txt`（已删除的未跟踪文件）exit 128，
  序列中止，`other.txt` 的有效提交未发生（HEAD 未动）。

**修复方向**：reconcile effect 中以 `snapshot.changes` 修剪 `selected`
（与 diff 选择协调同构）；或 commit 前按当前清单过滤 `paths`。

---

## BUG-C2（中高）diff 解析器丢弃以 `++ `/`-- ` 开头的内容行——视图静默丢数据

**位置**：`src/client/side-by-side.ts`
- `buildSideBySide` 的元信息正则（L56）：
  `/^(diff --git|index |--- |\+\+\+ |new file |…)/`
- `extractAddedContent`（L187）：`if (line.startsWith('+++')) continue`

**机理**：unified diff 的内容行与元信息行天然存在前缀歧义——
新增行的文本以 `++ ` 开头时，diff 行为 `+++ foo`，与 `+++ b/path` 头部同形；
删除行文本以 `-- ` 开头时同理（`--- bar` vs `--- a/f`）。项目解析器用
**行首前缀**而非 **hunk 行数**判别内容行，歧义内容行被当作元信息静默跳过：

| 场景 | diff 行 | 后果 |
|---|---|---|
| 并排视图：新增文本 `++ foo` | `+++ foo` | 整行从右列消失（左列删除行孤悬） |
| 并排视图：删除文本 `-- bar` | `--- bar` | 整行从左列消失 |
| 新文件视图：内容以 `++` 开头（含 `++i;`，**无需空格**） | `+++i;` | `extractAddedContent` 丢弃该行 |

**实测**（真实 git 生成的 diff 喂给项目函数）：
- 修改场景：`++ foo` → `++ foo CHANGED`，并排视图中"CHANGED"行**完全不存在**；
- 新文件场景：内容 `a / ++i; / ++ space line / b` 四行，新文件视图只剩
  `"a\nb"` —— **两行内容无声丢失**。

**触发面**：C++ 代码行首 `++i;`、Markdown/文档中的 diff 示例块、补丁文件仓库、
任何以 `++`/`--` 开头的文本行。用户看到的是「diff 与实际文件内容不符」，极难
归因。

**修复方向**：按 `@@` 头的行数消费 hunk 内容（权威解析）；或最少将元信息判定
收紧到 hunk 之外（首个 `@@` 前只跳过元信息行），hunk 内按计数取行。

---

## BUG-C3（中）unborn 仓库（首次提交前）无法取消暂存

**位置**：`src/host/actions.ts`
- `unstage` → `git restore --staged -- <path>`（L28）
- `unstage-all` → `git restore --staged -- .`（L30）

**机理**：`git restore --staged` 的参照物是 HEAD；仓库无任何提交时 HEAD 不存在。

**实测**（`git init` 后 add 文件）：

```
git restore --staged -- .     → fatal: could not resolve HEAD（exit 128）
git restore --staged -- a.txt → fatal: could not resolve HEAD（exit 128）
```

**影响**：新仓库「git init → 暂存 → 想反悔」是高频路径；此时 UI 的取消暂存
（单文件/全部）全部失败，只弹 git 原始错误，用户无路可走（只能去终端
`git rm --cached`）。

**修复方向**：host 检测 unborn（快照已带 `unborn` 标志）时改用
`git rm --cached -r --` 取消暂存。

---

## BUG-C4（中）diff 查询失败误显「无文件变更」

**位置**：`src/client/center/changes/ChangesTab.tsx` `showDiff`（L100）与渲染
（L368-369）

```ts
setDiffText(outcome.ok && … ? outcome.value.text : null)   // 失败 → null
…
: diffText === null ? <div>{t('center.diffEmpty')}</div>   // 「无文件变化」
```

**影响**：超时/git fatal/RPC 断连与「真的无差异」共用空态，且该文案是
「**无文件变更**」——对一个明明白白列在变更清单里、刚被点开的文件显示
「无文件变更」，自相矛盾。与第一轮 history B5 同类（彼处已修复）。

**验证**：jsdom（C-B，confirming）——query 返回失败，界面呈现
`center.diffEmpty` 文案。

**修复方向**：区分 `loading / error / empty` 三态（错误文案可复用
`history.detailFailed` 的先例）。

---

## BUG-C5（中低）每次轮询一律重取 diff——闪 loading、滚动与折叠状态丢失

**位置**：`src/client/center/changes/ChangesTab.tsx` 快照协调 effect
（L121-132，deps `[snapshot]`）

**机理**：控制器每 30s 轮询产生**新快照对象**（即使内容完全一致，`checkedAt`
必变）→ effect 重跑 → `showDiff` 先 `setDiffText(null)` + `setDiffLoading(true)`
→ 渲染分支把 `DiffSideBySide` **整个卸载**换成 loading 文案 → 响应到达后重挂载。

后果链（代码路径直接可证）：
1. diff 视图每 30s 闪烁一次 loading；
2. 滚动容器随组件卸载销毁——**用户正在阅读的长 diff 每 30s 被拽回顶部**；
3. `DiffSideBySide` 的 `expanded`（折叠展开态）随 `blocks` 重置——展开的上下文
   每 30s 自动收起。

「操作可能改变了同一文件，一律重取」是注释明示的设计意图；缺陷在于**重取期间
清空旧内容**而非保留旧内容直到新内容就位。

**验证**：jsdom（C-C）——变更清单完全一致的新快照对象到达后，diff 查询次数
2（期望 1，内容未变不应重取）。

**修复方向**：重取期间保留旧 `diffText`（仅在 `diffText === null` 时显示
loading）；进一步可在清单未变时跳过重取。

---

## 观察项（未计为 bug，供后续参考）

| # | 内容 | 不计 bug 的理由 |
|---|---|---|
| OBS-C1 | MM 双条目（同路径 staged+unstaged 两行）复选框联动、提交取工作区内容 | `ChangeRow.tsx` 顶部注释明示「联动为有意设计」 |
| OBS-C2 | `discard-all`（两步 restore）不清理未跟踪文件 | 与 VSCode「放弃更改」语义一致；按钮禁用条件也排除了纯未跟踪场景。若要「回滚到干净」需 `git clean`，属语义决策 |
| OBS-C3 | `armed` 哨兵用字符串 `'all'`，与名为 `all` 的仓库根文件路径碰撞（互触发确认态） | 病态命名才可触发，影响仅为确认态错位 |
| OBS-C4 | 选中行点击后 agent 恰好恢复该文件：worktree 空差异回退 `--no-index /dev/null` 会把已跟踪文件显示为「全新增」 | 轮询间隔内的竞态窗口，概率低；根因同 BUG-C4 的空态混淆 |
| OBS-C5 | `-U999999` 全上下文 diff 对超大文件产生等量文本传输 | 文档浏览体验的设计代价，host 有 spill/截断兜底 |
| OBS-C6 | 目录条目相关分支（`isDirectory` 行禁用 diff 等）为死代码——`--untracked-files=all` 下 git 不再产出目录条目 | 无行为影响 |

## 已核验无恙的点（防止后续重复怀疑）

- `commit` 两步序列（add → commit -- paths）在 **unborn 仓库可用**（实测
  root-commit 支持 pathspec 限定）；
- `unstage`（restore --staged）对 staged 删除条目正确回到未暂存 D 态；
- `discard`（restore）只出现在未暂存行；未跟踪行只有 Stage、staged 行只有
  Unstage——按钮矩阵与 git 语义对齐（`ChangeRow.tsx` 分支核验）；
- `isSafePath` 拒绝绝对路径/盘符/`..` 逃逸；所有命令 `--` 分隔，argv 直传
  无 shell——注入口闭合；
- `discard-all` 的两步顺序（先 reset index 再 restore worktree）语义正确；
- `reconcileDiffSelection` 对 MM 两侧迁移/消失的协调正确（已有单测覆盖）；
- `useWindowSlice` 的切片计算对 total=0、scrollTop 越界等边界安全
  （`computeWindow` 已有单测）；
- 折叠标记的可见流坐标定位与窗口化垫片兼容（`foldMarkerLines` 有单测）；
- 二进制 diff 有专门空态（`diff.binary`）。

## 修复优先级建议

1. **BUG-C1**（提交功能可永久卡死 + 场景高频——agent 持续改工作区是本插件的
   日常环境）；
2. **BUG-C2**（视图静默丢内容，动摇「diff 即事实」的信任基础；修复需重写
   hunk 解析，注意回归现有 `side-by-side` 单测）；
3. **BUG-C3 + BUG-C4**（各自独立小修：unborn 分支 + 错误三态）；
4. **BUG-C5**（重取期间保留旧内容；可顺带做「清单未变跳过重取」）。

---

## 修复记录（2026-08-26 同分支落地）

| # | 修复 | 位置 | 回归锁 |
|---|---|---|---|
| C1 | 选择集随快照修剪：新增 effect 按 `snapshot.changes` 路径存活集修剪 `selected`（与 diff 选择的 reconcile 对称） | `ChangesTab.tsx` | `changes-stale-select.spec.tsx` C-A |
| C2 | hunk 配额感知解析：`buildSideBySide`/`extractAddedContent` 按 @@ 头行数配额消费内容行——配额外的行才是元信息，`+++i;`/`--- bar` 等歧义内容行不再被丢弃 | `side-by-side.ts` | `side-by-side.spec.tsx` 新增 describe（真实 git 输出夹具） |
| C3 | unborn 仓库 unstage：`runAction` 先以 `rev-parse --verify --quiet HEAD` 探测，无 HEAD 时 `buildArgv` 改用 `git rm --cached -r --`（等价取消暂存） | `actions.ts` | `actions.spec.ts` 两个 unborn 用例 |
| C4 | diff 失败三态：新增 `diffFailed` 状态 + `diff.loadFailed` 文案（zh/en），失败不再误显「无文件变更」 | `ChangesTab.tsx`/`locales.ts` | C-B（反转断言） |
| C5 | 同目标静默刷新：`showDiff` 对同 path+base 的重取保留旧 `diffText`、不置 loading——DiffSideBySide 保持挂载（滚动/折叠态不丢），内容就位后原位替换；有内容时静默刷新失败不打断阅读 | `ChangesTab.tsx` | C-C（内容在场 + 不闪 loading + 重取发生） |

附带修正：`side-by-side.spec.tsx` 三处合成夹具的 @@ 头行数与内容不一致
（真实 git 输出必一致），已改为配额自洽——这也是 C2 重写后它们必须
更新的原因。全套件 544/544 通过、typecheck 通过。
