# 记录（Records / Turn 工作记录）界面前后端 Bug 狩猎报告

> 分支 `fix/bug-hunt` · 2026-08-26 · 基线 `116a1cf`（含前两轮 history/changes 修复）
> **状态：五项已全部修复（见文末「修复记录」），复现测试转为回归锁。**
> 范围：记录子系统全链路 ——
> host 侧 `turns.ts`（事件折叠）/ `observation.ts`（观测时间线）/ `record-store.ts`
> （状态机与持久化）/ `record-assembly.ts`（三分归因组装）/ `turn-records.ts`
> （查询编排与去向升级）/ `path-state.ts`（判定缓存）→ client 侧
> `records/derive.ts`（时段合并）/ `index.tsx` / `session-card.tsx` / `entry-row.tsx`
> / `overrides.ts`（人工纠错）/ `unread.ts`（未读）/ `use-turn-records.ts` /
> `GitPill.tsx` 的记录接线（弹窗单 turn 视图、未读清零、纠错写盘）。

## 方法与 UX 流程分析

本模块的用户心智模型（README 承诺）：**「这轮工作动了什么、谁动的」** ——
三方作者（本会话 AI / 其他会话 AI / 人工）× 四态去向（仍变更 / 已提交 /
已还原 / 已消失）× 时段聚合 × 未读增量 × 人工纠错闭环。本次嗅探除常规
数据链路外，重点推演了以下 UX 流程的逻辑闭合性：

1. **时段合并流程**：相邻 turn（间隔 ≤10min）合并为时段卡片 —— 条目并集怎么处理？
2. **未读流程**：pill「new N」→ 打开弹窗/记录页清零 → 新条目再计数 —— 「查看」的边界定义是否与数据流对齐？
3. **纠错流程**：⇄ 改判三方作者 —— 状态机的可达性/可逆性？
4. **去向收敛流程**：gone → 权威探测 → committed/reverted —— 三方作者是否同等收敛？
5. **加载流程**：records 的 null 语义 —— 加载中/失败/未开启是否可区分？

复现测试（全部入库）：

- `tests/client/records-merge-dup.spec.tsx` — R-D1/R-D2（expected-fail）、R-T（confirming）
- `tests/records-sibling-gone.spec.ts` — R-AH（expected-fail + 通过的对照组）
- `tests/records-reclassify-trap.spec.ts` — R-J（confirming）

全量套件：**48 文件 / 547 通过 / 3 expected-fail**，typecheck 通过。

---

## BUG-R1（中高）时段合并不去重路径——同卡片重复行 + 徽章/摘要计数虚高

**位置**：`src/client/records/derive.ts` `buildSessions`（L64-74）

```ts
internal: [...last.internal, ...turn.internal],
```

**机理**：host 归因是 **per-turn** 的——同一文件被 turn1 和 turn3 都写过 →
两份 turn 记录的 internal 各含该路径（`record-assembly.ts` 的 `internalOf`
按 turn 的 toolCalls 提取）；外部文件跨窗口多次修改（firstSeen 在 turn1 窗口、
mtime 落在 turn3 窗口）同理产生多份 external 条目。合并相邻 turn 为时段时
**直接拼接不去重**，注释「组装层已按路径去重」只对单 turn 内成立，跨 turn
不成立。

**用户可见后果**：
1. 展开的时段卡片里**同一文件出现多行**（用户：「为什么这个文件列了两遍？」）；
2. `EntryRow key={entry.path}` 产生 **React duplicate key 告警**（刷控制台）；
3. 卡片头部三分徽章计数（`internalEntries.length`）与工具栏「M 个文件」摘要
   （`summarizeSessions` 按条目求和）双双虚高；
4. 「暂存 AI 成果」的路径列表含重复（`git add` 幂等，无功能损害）。

**验证**：R-D1——turn1 与 turn2 都写 `a.ts`，合并后 `internal` 为
`["a.ts","a.ts","b.ts"]`；R-D2——jsdom 渲染捕获 duplicate-key console.error。

**修复方向**：合并时按路径去重（保留信息更全的一份——如 state 更新者 /
`firstSeenAt` 更早者；dirty 优先于终态）。

---

## BUG-R2（中高，UX）⇄ 纠错对 sibling 组单向且不可逆——误改判永久丢失归因

**位置**：
- `src/client/records/entry-row.tsx`（L76-78）——按钮方向
  `group === 'internal' ? 'external' : 'internal'`
- `src/client/records/overrides.ts`（L16）——`AuthorOverride = 'internal' | 'external'`

**机理**（两个叠加缺陷）：

1. **单向**：sibling 行的 ⇄ 只提供「改归本会话 AI」一个方向。想把 sibling
   条目归**人工**没有直接路径——必须先点到 internal、再从 internal 点到
   external（两步，且 UI 无任何提示哪条路通向哪里）。
2. **不可逆**：override 值域只有 internal/external 两个值，撤销语义
   `setOverride(..., null)` 在 UI 层**零调用点**。sibling 条目一旦被改判
   （哪怕手滑），「其他会话 AI 写的」这个正确归因**永久丢失**——internal ↔
   external 可往返，但都回不到 sibling。

**用户场景**：用户看到 sibling 条目想「这是我手动改的」→ 点 ⇄ → 条目进了
internal（而非预期的 external）→ 再点 ⇄ 进了 external —— 但此时想撤销回到
sibling 组已无任何通道；改判还**仓库级持久化**（overrides.json），跨会话生效。

**验证**：R-J（confirming）——镜像 UI 的 ⇄ 行为驱动真实 override 管线：
第 1 击 sibling→internal，第 2 击 internal→external，穷举后续全部可达状态，
sibling 组永不可能重新包含该路径。

**修复方向**：⇄ 改为循环三态（internal → sibling → external → internal）
或按钮组三选 + 显式「撤销改判」出口（`setOverride(..., null)` 已具备能力，
缺的只是 UI 通道）。

---

## BUG-R3（中，host）sibling 组的「已消失」条目永不被探测升级——去向收敛遗漏第三方

**位置**：`src/host/turn-records.ts` `upgradeGonePaths`（L129-136）

```ts
for (const entry of turn.internal) { if (entry.state === 'gone') gone.add(entry.path) }
for (const entry of turn.external) { if (entry.state === 'gone') gone.add(entry.path) }
// ← turn.sibling 从未被遍历
```

**机理**：去向升级（gone → committed/reverted 的权威 git log 探测）只对
internal 与 external 两组收集候选——**sibling 组的 gone 条目永远不在候选集**。
其他会话 AI 写入的文件消失后（已被提交/已还原），条目永久停留「已消失」
中性态：状态徽章永远不落定、`已提交` 的深链跳转永远不出现（committed 才
可点击）、`≈` 推断标记也永远无法被权威判定洗掉。

**验证**：R-AH——`runTurnRecords` 端到端（内存持久化 + 桩 sources）：
- **对照组**（external 条目同场景）：`state=committed`，`probed=['s.txt']`
  ——证明探测链路本身工作；
- **sibling 组**：`state=gone`，`probed=[]`——从未进入探测。

三方作者在「条目去向四态收敛」上不同权——与 README「committed 条目深链
定位提交」对全部条目的承诺不符。

**修复方向**：gone 候选收集补 `turn.sibling`（一行修复；探测配额/冷却机制
自动覆盖）。

---

## BUG-R4（中，UX）「加载中」被渲染为「加载失败」——failed 标志被丢弃

**位置**：
- `src/client/use-turn-records.ts`——hook 返回 `{ records, failed }`；
- `src/client/GitPill.tsx` L91——`const { records } = useTurnRecords(...)`，
  **`failed` 被解构丢弃**；
- `src/client/records/index.tsx` L78-80——`records === null` 一律渲染
  `work.loadFailed`（「加载失败」）。

**机理**：`records === null` 同时承载三种互异语义——①首次加载中（首快照
未就绪，慢仓库秒级）；②查询失败（会话不可用/降级）；③记录功能数据源禁用
（display 非 ready）。RecordsTab 无从区分，一律显示「加载失败」。用户在
大仓库打开记录页，先是秒级「加载失败」闪现、然后内容突然出现——失败文案
先于任何真实失败出现，狼来了效应直接破坏该文案的可信度。

**验证**：R-T（confirming）——`records={null}` 渲染即含 `work.loadFailed` 文案。

**修复方向**：把 `failed` 传到 RecordsTab（或 hook 暴露 loading 态），
空态三分：加载中 / 加载失败 / 无时段。与 history/changes 两轮的
「失败≠空态」修复（B5/C4）同族。

---

## BUG-R5（中，UX）用户正在查看记录时流入的新条目仍计未读——「查看即清零」的边界漏洞

**位置**：`src/client/GitPill.tsx` L153-160

```ts
useEffect(() => { if (open) markWorkSeen() }, [open])
useEffect(() => { if (centerOpen && centerTab === 'records') markWorkSeen() }, [centerOpen, centerTab])
```

**机理**：已读标记是**边沿触发**（仅在打开弹窗/切入记录页的瞬间写一次
`seenAt = now`）。而记录数据随 `checkedAt` 刷新键**持续流入**
（`useTurnRecords`，30s 轮询 + turn 完成即刷）。用户停留在记录页期间新到的
条目 `firstSeenAt > seenAt` —— 计入未读：

1. 用户**正看着**新条目出现在列表里（已读事实成立），pill 的「new N」却
   从 0 涨起，且查看期间不会再次清零（deps 未变，effect 不重触发）；
2. 关闭中心后再看 pill——「new N」宣称有 N 条新记录，点开却都是刚才已经
   看过的内容——未读信号失信，「要不要关心」的判断依据被污染。

**验证**：代码级论证（effect 依赖数组与刷新链路正交，`markWorkSeen` 无随
records 更新的重触发路径）；未做 jsdom 复现（GitPill 挂载需完整平台上下文，
收益不成比例）。

**修复方向**：records 到达且视图处于「正在查看」态时同步重标
（如在 markSeen effect 中加入 records 刷新依赖，或查看期间悬挂未读计数）。

---

## 观察项（未计为 bug，供后续参考）

| # | 内容 | 不计 bug 的理由 |
|---|---|---|
| OBS-R1 | 进行中时段的结束钟面（`windowText` 用 `Date.now()`）渲染后不随时间推进 | 纯静态展示瑕疵，下次重渲染自愈 |
| OBS-R2 | 工具栏「M 个文件」按条目计数而非唯一路径 | 随 BUG-R1 修复自然消解 |
| OBS-R3 | pill 未读徽章 >0 时三分计数徽章全部隐藏 | README 明示的设计（「先增量后总量」） |
| OBS-R4 | EntryRow 仍变更条目点击硬编码 `worktree` 基线 | MM 双条目迁移由 ChangesTab 的 reconcile 协调兜底 |
| OBS-R5 | `reclassify` 写盘失败静默（内存态仍生效） | 代码注释明示的取舍，且写前合并已防并发丢失 |
| OBS-R6 | overrides 按仓库根索引——同仓库全部会话共享改判 | 「仓库级事实」是文档化语义 |
| OBS-R7 | sibling 探测遗漏修复后，`RECONCILE_PROBE_CAP=50` 的恢复对账上限对多 sibling 条目仓库可能截断 | 既有容量护栏，超出部分下轮收敛 |

## 已核验无恙的点（防止后续重复怀疑）

- 间隙归属的**半开区间**设计：`firstSeenAt === prevEnd` 只归上一 turn，
  无双归（`collectNonInternal` 的 `>`/`<` 边界核验）；
- override 搬移矩阵含 sibling→internal 方向（P1-1 历史修复仍在位）；
- 未读计数覆盖全部三组、跨长 turn 不按 startAt 剪枝（`countUnseen` 注释
  与实现一致）；
- `mergeOverrides` 写前合并——并发实例改判与本实例连续快速改判都不丢；
- `narrative` 恢复只填 null 槽位、新鲜事件优先（`restoreNarratives` +
  `narrativeFresh` 双保险）；
- `ObservationLog.restore` 的内存优先合并（ensure→restore 竞态窗口）；
- `PathStateTracker` 的配额/冷却/容量护栏（beginCycle 冷却期 budget=0 的
  早退路径正确）；committed 不被 reverted 覆盖的最终事实语义；
- 观测 `update` 的 truncated 防误判消失、prune 双重容量截断；
- `latestWorkTurn` 只认含工具调用的 turn（纯提问不产生工作窗口）；
- 指纹 fresh 标记的「上一 turn 边界不含该路径」判定方向正确。

## 修复优先级建议

1. **BUG-R1**（数据完整性：重复行直接动摇「记录=事实」的信任，且修复
   局限在 `buildSessions` 一处纯函数）；
2. **BUG-R3**（一行修复，消除三方作者的去向收敛不同权）；
3. **BUG-R2**（纠错 UX 闭环：三态循环或撤销出口；注意 overrides 契约
   向后兼容——旧值域不变，UI 侧扩通道）；
4. **BUG-R4 + BUG-R5**（同族 UX 修复：状态语义分野 + 未读边界对齐，
   可一批处理）。


---

## 修复记录（2026-08-26，同分支落地）

| # | 修复方案 | 回归锁 |
|---|---|---|
| BUG-R1 | `derive.ts` 新增 `mergeByPath`/`mergeEntry`：合并相邻 turn 时三组条目按路径去重，合并排序键 = 状态信息量（dirty>committed>reverted>gone）× 归因置信（authoritative>inferred），firstSeenAt 取更早、fresh 取或；`unread.ts` 的 `countUnseen` 同步按路径取最大 firstSeenAt 计数（未读口径与视图去重口径一致） | `records-merge-dup.spec.tsx` R-D1/R-D2 + `records-derive.spec.ts` 去重组（5 例锁定优先级语义） |
| BUG-R2 | override 值域扩 `'sibling'`（旧文件为子集，天然向后兼容；旧客户端读新值静默降级回启发式）；搬移矩阵改 3×3 全方向；⇄ 改三态循环 internal→external→sibling→internal（全可达置换，任两组至多两击互通，误改判完全可逆）；title 动态标注目的地（新增 `work.reclassify.sibling` zh/en） | `records-reclassify-trap.spec.tsx`（循环回归 + 3×3 矩阵 + 兼容性，5 例） |
| BUG-R3 | `turn-records.ts` 的 `upgradeGonePaths` gone 候选收集补 `turn.sibling` 遍历——三方作者同等进入权威探测（配额/冷却护栏自动覆盖） | `records-sibling-gone.spec.ts`（sibling 与 external 同场景对照） |
| BUG-R4 | `useTurnRecords` 的 `failed` 标志穿透 GitPill → GitCenter（`recordsFailed`）→ RecordsTab（`loadFailed`），records=null 空态三分：加载中（`center.loading`）/ 加载失败（`work.loadFailed`）/ 有数据 | `records-merge-dup.spec.tsx` R-T + `records-tab.spec.tsx` 契约更新 |
| BUG-R5 | GitPill 两个边沿已读效应合并为 `[viewingRecords, viewRecords]` 单效应——查看期间每批记录到达即重标已读，「new N」不再统计用户正在看的内容 | 代码级论证（GitPill 挂载依赖完整平台上下文，jsdom 复现收益不成比例） |

修复后全量套件：**49 文件 / 559 通过 / 0 expected-fail**（原 3 个 expected-fail 复现全部转正为回归锁），typecheck 通过。

复审补注：注释中的修复引用统一为 `BUG-R1..R5` 前缀——裸 `R3` 与同文件中「命令风暴」事故纪律编号（`R3 纪律`，见 path-state.ts）撞名，已消歧。
