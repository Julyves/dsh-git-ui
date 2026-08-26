# History 界面前后端 Bug 狩猎报告

> 分支 `fix/bug-hunt` · 2026-08-26 · 基线 `57060db`（dev 顶端）
> **状态：7 项 bug 已全部修复并带回归锁**（各条目「修复方向」即实际落地方案；
> 回归测试：`tests/client/history-load-retry.spec.tsx`（B1/B5）、
> `tests/client/filter-tree-key-star.spec.tsx`（B4/B7）、`tests/queries.spec.ts`
> 的 bug-hunt describe（B2×4 含组合交互/B3×2/B6））。
> 复审补获：B2 首版用 `--fixed-strings`，复审实证 git 的 `-F` 会同时作用于
> `--author`，与 author 转义形态互斥（搜索+作者组合时匹配失效）——终版统一
> 为 BRE + `escapeBre` 单一转义路径，无标志交互面。
> 范围：Git 中心 History 标签的完整数据链路 ——
> host 侧 `queries.ts`（history/show/branches/tags/authors）→ `parser.ts` 解析 →
> controller 查询通道 → client 侧 `HistoryTab.tsx` / `HistoryFilterTree.tsx` /
> `CommitRow.tsx` / `git-graph.ts` / `file-tree.ts` / `time-format.ts`。

## 方法

1. 通读上述全部源文件（约 2,300 行），列出候选缺陷；
2. 对每个候选做**真实性与可复现性验证**：
   - 临时仓库 + 真实 git 命令验证 host 侧行为（B2/B3/B6/B10）；
   - jsdom + createRoot 交互式组件测试验证 client 侧行为（B1/B4/B5/B9），
     复现测试已入库（`it.fails` 形态，修复后自动翻红提示反转）；
3. 证伪与降级：无法证实或影响可忽略的候选归入「观察项」，不计为 bug。

复现测试文件（本报告的证据，均已运行通过/按预期失败）：

- `tests/client/history-load-retry.spec.tsx` — B1（expected-fail）、B5（confirming）
- `tests/client/filter-tree-key-star.spec.tsx` — B4、B9（expected-fail）

全量套件状态：**45 文件 / 525 通过 / 3 expected-fail**。

---

## BUG-1（高）续载失败 + 贴底 → 无限失败请求风暴

**位置**：`src/client/center/history/HistoryTab.tsx`
- 底部静置自动续载 effect（约 L335-340，deps `[commits, loading, hasMore]`）
- `loadPage` 失败路径（约 L209 `if (!outcome.ok) return`）

**机理**：续载页查询失败时，`loadPage` 只做 `setLoading(false)` 后静默返回——
不设 `reachedEnd`、不设错误态、无退避。`loading` 作为 effect 依赖从 `true`
回落 `false`，effect 重跑；若滚动容器仍贴近底部（`scrollHeight - scrollTop -
clientHeight < 320`）且 `hasMore` 为真，再次发起 `loadPage` → 再失败 → 再触发，
**无界循环**。每轮一次 `git log` + `git rev-list --count` + `git remote`
（host 侧每次 history 查询 3 条命令），以查询往返时间为周期无限打点。

**触发条件**：首页加载成功（`total > commits.length`）后用户滚动到底部，任一续载页
失败——大仓库 `git log --all` 超时（默认 `timeoutMs=5000`）、瞬时 RPC 断连均可达。
失败后**无需任何用户交互**即持续风暴。

**验证**：`history-load-retry.spec.tsx` B1 —— mock 首页成功（total=3）、续载失败
（带 25ms 真实延迟），800ms 观测窗内打出 **27 次**失败续载（仅受窗口限制，
400 次安全阀未触及）。

**关键插曲（为何此前未被发现）**：立即 resolve 的 mock 下 React 把 `loading` 的
`true→false` 批处理合并为一次无变化渲染，effect 观察不到中间值，循环被「侥幸」
刹住（实测仅 2 次重试）。真实 git 查询必然有耗时（数十 ms～5s），`loading=true`
的渲染先落盘，循环必然成立——这解释了该缺陷在开发自测中隐身的原因。

**修复方向**：失败路径设置错误态（联动 BUG-5）并停用自动续载（如置
`reachedEnd` 或引入 `loadError` 哨兵），手动刷新/滚动显式重试时清除；
或对连续失败做有界退避。

---

## BUG-2（中高）搜索输入未转义地作为 POSIX ERE 传给 `--grep`

**位置**：`src/host/queries.ts` `historyQuery`（约 L84）

```ts
filters.push('--regexp-ignore-case', '--extended-regexp', `--grep=${search}`)
```

用户输入未经转义直接成为扩展正则。三类后果（均在临时仓库实测）：

| 输入 | 现网行为 | 期望行为 |
|---|---|---|
| `feat(graph)`（提交主题字面含此串） | **0 匹配**（捕获组吞掉括号） | 1 匹配 |
| `(`（不平衡括号） | git fatal exit 128 → 整个查询失败 → UI 显示「无结果」 | 按字面搜索 |
| `a+b` / `[abc]` / `x?` | 静默匹配错误集合 | 按字面搜索 |

`--author` 同机制（L86）：作者名是字面数据，含未配对括号即全线失败；
含 `.` 等元字符过度匹配（`--author=A.B` 命中 `AXB`）。

**与 BUG-5 复合**：正则非法导致的查询失败被吞，用户只看到「无结果」，
无从得知输入非法。

**修复方向**：`--fixed-strings`（`-F`）做字面搜索（README 宣告的语义就是
text-or-hash）；若保留正则能力则需对输入转义 + 捕获 git fatal 转错误提示。

---

## BUG-3（中）merge 提交详情的变更文件树恒为空

**位置**：`src/host/queries.ts` `showQuery`（约 L180）

```ts
['git', '-c', 'core.quotePath=false', 'show', '--format=', '--name-status', '-z', ref]
```

对 merge 提交，`git show` 默认走 **combined diff**：只列出与两个父提交都不同的
文件（即冲突解决产物）。干净 merge 输出 **0 字节**。

**实测**（临时仓库，dev → main 的普通 merge）：
- 现网命令：输出 0 字节 → 右栏显示 `center.diffEmpty`（「差异为空」）
- `--first-parent` 对照：`A c.txt`（IDEA 式首父差异列表）

**影响**：仓库里几乎每个 merge 提交的详情都是空树，用户误以为 merge 没有引入
任何变更。历史越 merge 密集，右栏越「什么都没有」。

**修复方向**：对多父提交追加 `--first-parent`（IDEA 语义）；或 UI 在 stats 为空
且 `parents.length > 1` 时展示「合并提交——显示首父差异」的显式态。

---

## BUG-4（低中）HistoryFilterTree 行组件缺 React key

**位置**：`src/client/center/history/HistoryFilterTree.tsx` `row()`（约 L51-74，
返回的 `<button>` 无 `key`），4 个 `.map((b) => row(...))` 调用点
（搜索态本地/远程两处 + 本地根/文件夹/远程组三处）。

**验证**：`filter-tree-key-star.spec.tsx` B4 —— jsdom 渲染即产生 React 开发告警
`Each child in a list should have a unique "key" prop`。

**影响**：控制台告警刷屏（开发/调试构建）；无 key 列表退化为位置匹配，
未来行内引入状态（如局部 hover 态）时会错位。`tagRow` 有 key、`row` 没有，
属一致性遗漏。

**修复方向**：`row()` 增加 `key={name}`（分支名在树内唯一）。

---

## BUG-5（低中）history 查询失败被吞，UI 显示「无结果」

**位置**：`src/client/center/history/HistoryTab.tsx`（约 L444-446）

```tsx
{!loading && commits.length === 0 && (<div>{t('history.noResults')}</div>)}
```

查询失败（超时/git fatal/RPC 断连）与「真的没有匹配」共用同一空态文案。
用户搜索无结果时无法区分「没找到」与「查询坏了」；配合 BUG-1 风暴期间
列表区闪烁且毫无解释。

**验证**：`history-load-retry.spec.tsx` B5（confirming：断言当前错误行为成立）。

**修复方向**：`loadPage` 记录失败态（如 `listError`），空态区分
`noResults` / `loadFailed`（详情面板已有 `history.detailFailed` 先例，H3）。

---

## BUG-6（低）深链定位与 author/since 过滤互斥

**位置**：
- `src/client/center/history/HistoryTab.tsx` 深链 effect（约 L305）——只清 `ref`，
  保留 `author`/`since`
- `src/host/queries.ts` hexLike 分支（约 L81-88）——`--no-walk <hash>` 仍附加
  `--author`/`--since` 过滤

**实测**：`git log --skip=0 -n 60 --no-walk <merge-hash> --author=nobody` → 0 条
（无作者过滤 → 1 条）。

**影响**：用户在 History 设了作者/日期过滤后，从记录页点「已提交」条目深链，
目标提交被过滤掉 → 定位静默失败（`pendingFocus` 一次性消费，无选中、无提示）。

**修复方向**：深链时同时清空 `author`/`since`（定位语义优先），或 hexLike
分支不附加内容过滤。

---

## BUG-7（低）本地文件夹分支误标默认分支星

**位置**：`src/client/center/history/HistoryFilterTree.tsx` `branchFace`（约 L48）

```ts
if (tree.defaultBranch !== null && bare === tree.defaultBranch) return { icon: <StarIcon/>, color: amber }
```

`bare` 是**剥掉第一段斜杠前缀**后的名字。本地分支 `feature/main` 的 bare 为
`main`，与 `defaultBranch='main'` 相等 → 显示默认分支星标 + 琥珀色，但它不是
默认分支。远程组的 `origin/main` 得星是合理的（默认远程分支），但同一规则套在
本地文件夹分支上就失真了。

**验证**：`filter-tree-key-star.spec.tsx` B9 —— 树含 `main`/`dev`/`feature/main`/
`feature/x`（current=dev）时星形出现 **2** 次（期望 1）。

**修复方向**：默认分支判定用完整名 `name === tree.defaultBranch`（本地根分支），
文件夹/远程行仅在「该行确实是默认 ref」时标星（如 `origin/<defaultBranch>`
整名比对）。

---

## 观察项（未计为 bug，供后续参考）

| # | 内容 | 不计 bug 的理由 |
|---|---|---|
| OBS-1 | 列表按提交日期排序、显示作者日期（`%aI`）：rebase/cherry-pick 提交的顺序与显示时间错位（本仓库 2/153 条受影响） | IDEA 同样显示作者日期，属工具惯例取舍 |
| OBS-2 | `authorsQuery` 只枚举最近 1000 条提交的作者，更早的作者不进下拉 | 有界查询的设计代价，文档化即可 |
| OBS-3 | `defaultBranch` 仅从 `origin/HEAD` 解析；主远程非 `origin` 时为 null（星标缺失） | 覆盖绝大多数仓库；可后续做多远程探测 |
| OBS-4 | 跨页续载期间 refs 移动（新推送/新提交）会使 `--skip` 偏移漂移，出现重复或跳条 | git log 分页的固有语义，快照式分页才能根除 |
| OBS-5 | `parseDecorations` 会把名为 `origin/x` 的**本地**分支误归 remote 类 | git 本身允许此命名，但实际仓库几乎不存在 |

## 已核验无恙的点（防止后续重复怀疑）

- `git log -n N` 前置于 `--no-walk` 的顺序：实测恒返回单条（注释所述修复有效）；
- `createTipAwareColorOf` 的短哈希前缀匹配：git 缩写按唯一性自动延长，不同提交
  不可能共享 tip 短哈希前缀，无误匹配；
- `createColorAllocator` 的贪心避撞与耗尽回落逻辑正确；
- `rev-list --count` 与 `git log` 共用同一组过滤参数，total 口径一致；
- 大写十六进制前缀（`A-F`）深链可正常命中（`hexLike` 带 `i` 标志，git 接受）；
- `%s` 主题由 git 规范化为单行，按 `\n` 切分日志安全；`%b` 正文经
  `parseShowMeta` 的 rest-join 保真（含换行与分隔符）。

## 修复优先级建议

1. **BUG-1 + BUG-5**（同一修复面：失败路径的错误态与续载刹车）——风暴是资源
   级问题，且用户完全无感；
2. **BUG-2**（搜索正确性：`-F` 字面搜索 + 非法输入错误提示）；
3. **BUG-3**（merge 详情 `--first-parent`）；
4. **BUG-6 / BUG-7 / BUG-4**（低风险局部修复，可一批处理）。
