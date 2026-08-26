# dsh-git-ui

[![npm version](https://img.shields.io/npm/v/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)
[![npm license](https://img.shields.io/npm/l/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)
[![npm downloads](https://img.shields.io/npm/dm/dsh-git-ui.svg)](https://www.npmjs.com/package/dsh-git-ui)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）Web UI 插件：在会话界面中可视化展示 Git 状态——会话头部的 Pill 一眼呈现当前分支（或游离 HEAD）与脏状态计数（已暂存/已修改/未跟踪）及领先/落后。点击查看最近提交与变更文件，或打开 Git 中心进行完整管理。无需切换终端。

> English version: [README.md](README.md)

- 📦 **npm**：<https://www.npmjs.com/package/dsh-git-ui>
- 🐙 **GitHub**：<https://github.com/Julyves/dsh-git-ui>
- 🐛 **Issues**：<https://github.com/Julyves/dsh-git-ui/issues>



## 功能特性

### 会话头部分支 Pill

每个会话头部右侧的独立状态胶囊：状态点（干净为绿、脏为橙）+ 分支名 + 脏/领先落后徽标，点击展开详情面板：

<img src="docs/screenshots/01-pill面板内容展示.png" alt="会话头部分支 Pill 与展开的详情面板" width="720">

| 状态 | Pill 显示 |
|---|---|
| 干净 | `● main` |
| 脏状态 | `● main · +2 −1 ?3` |
| 领先/落后 | `● main · ↑1 ↓2` |
| 游离 HEAD | `● (游离 HEAD) · a1b2c3d` |
| unborn（无提交） | `● main · 无提交` |
| 非 git 仓库 | 弱化显示 `无 Git 仓库` |
| git 不可用/出错 | 弱化显示 `Git 不可用`（tooltip 显示原因） |

`+N −N ?N` = 已暂存/已修改/未跟踪；`↑N ↓N` = 领先/落后。脏且领先落后时徽标合并（如 `● main · +2 −1 ?3 · ↑1 ↓2`）。

### 详情面板

点击 Pill 打开的详情：仓库根目录、状态计数与脏/领先落后徽标、最近提交（哈希·主题·作者·相对时间——点击任一提交可跳转历史页并定位选中该提交）、变更文件列表（状态 chip + 行内暂存/取消/丢弃操作）、分支内联切换、手动刷新按钮、上次检查时间：

<img src="docs/screenshots/02-面板选择切换分支.png" alt="详情面板内的分支内联切换" width="720">

### Git 中心

从面板进入的管理面板，四个标签——**历史**（默认首项与落地页）、**变更**、**记录**与**设置**，统一阅览与操作工作区：

<img src="docs/screenshots/03-Git中心统一阅览文件变更.png" alt="Git 中心——变更标签（分组文件变更）" width="720">

- **变更**：IDE 式三段分组（已暂存/更改/未跟踪），单文件与全部暂存/取消暂存/丢弃（两步确认）、提交框（勾选文件或全部已暂存），以及选中文件的并排差异对照（前后导航）。
- **历史**：分页提交列表 + 分支图渲染，按分支/标签/作者/日期/文本或哈希过滤，以及拉取远程按钮。分支树中的前缀分组（`feat/*`、`fix/*`、远程 origin 组）默认收起，列表更规整：

  <img src="docs/screenshots/04-Git中心查看分支历史.png" alt="Git 中心——历史标签（提交列表与分支图）" width="720">

  选中提交后，右侧展示提交详情（主题·正文·变更文件树，目录可展开/折叠）。**点击文件树中的文件**跳转变更页，以该提交为基线展示此文件的变更，工具栏以提交哈希徽标标识所属提交：

  <img src="docs/screenshots/04-Git中心查看提交详情.png" alt="Git 中心——历史标签（提交详情与变更文件树）" width="720">

- **记录**：Turn 工作记录的时段时间轴视图（见下节）。

  <img src="docs/screenshots/05-Git中心查看Turn记录.png" alt="Git 中心——记录标签（Turn 工作记录时段）" width="720">

- **设置**：Pill 信息组件与差异查看器的可配置项——实时预览、四档显示模式（极简/标准/完整/自定义，纯派生——手动调整重新匹配预设时自动吸附回档位）与逐项开关：状态点、分支名、三类变更计数徽标、领先/落后、工作记录徽章；弹窗区块：仓库路径、状态栏、分支切换器、新建分支行、最近提交条数、变更文件列表、工作记录区块（与 pill 徽章独立开关）；**弹窗区块顺序**：用上下箭头自定义详情弹窗内各区块的展示顺序（隐藏的区块保留在序列中，开启后按序出现；排序独立于显示模式档位）；另有差异查看器组（代码字号、语法高亮、上下文折叠）。点击面板头部齿轮图标直达：

  <img src="docs/screenshots/06-Git中心管理插件设置.png" alt="Git 中心——设置标签（显示模式与开关）" width="720">

### Turn 工作记录

按 turn 归因文件系统变更，回答「**这轮工作动了哪些文件、是谁动的**」，统计严格基于 git（ignored / 仓库外文件不计）。

- **单 turn 模式（Pill，默认）**：最近工作时段的紧凑徽章——增量未读优先（自上次查看 `新 N`，查看即清零），其后为作者三分计数（`本` 本会话 agent / `会` 其他 dsh 会话 AI / `外` 人工）。点击胶囊查看分组文件列表与任务叙事；【设置】中可关闭徽章。
- **全 session 模式（Git 中心「记录」标签）**：连续有工作的 turn 聚合为**工作时段**（默认间隔 10 分钟内合并）——时段卡片流：头部为**任务叙事**（驱动该时段的用户指令摘要，「做了什么」先于「何时」）+ 时间窗 + 三分计数；展开为「本会话 / 其他会话 / 外部」三组文件（状态徽章：仍变更 / 已提交 / 已还原 / 已离开）；顶部工具栏提供摘要（时段数 · 文件数 · 仍待提交）与四路过滤。**任何时段都可点击展开**——未产出文件变更的时段头部弱化标注「无变更产出」，展开区显示空态说明。
- **作者三分**：`本会话`（本会话 agent 含 subagent 委托）/ `其他会话`（同工作区其他 dsh 会话的 AI 写入）/ `外部`（人工：IDE / 命令行 / 未识别来源）——归因轴对齐用户心智：「AI 改的」与「我改的」不再混桶。其他会话归因固化于观测时间线，会话离场或宿主重启后不漂移。
- **行动闭环**：时段卡片展开区支持**批量暂存**（「暂存 AI 变更」= 本会话+其他会话的仍变更、不带人工 WIP；「暂存全部」）；**已提交条目点击直达历史页对应提交**（自动定位并选中）。
- **归因置信度 + 人工纠错**：平台自证写意图的条目为实心徽章；启发式推断的条目为虚线徽章 + `≈` 标记——误差可见。悬停条目 `⇄` 可人工改判归因（仓库级持久化，弹窗/记录页/未读计数统一生效）。
- **本轮新增识别**：每轮工作边界被快照捕获，不在上一轮边界内的条目标记「新」，一眼看出本轮新增。

原理：宿主折叠会话事件日志（`turn/start`·`turn/end`·`tool/call`·`user/message` 自带时间戳）得到精确的 per-turn 窗口与任务叙事；复用每个工具自声明的写意图提取 agent 写路径（bash 走静态目标启发式）；其他会话写入经同 cwd 会话枚举归并；外部变更经轮询观测时间线归因（每路径首见时刻 + HEAD 移动提交检测 + 仍脏文件的 mtime 精修）。观测时间线与叙事/指纹等持久化于宿主插件数据目录，宿主重启后记录不丢。

### 差异对照增强

变更标签的并排查看：

- **视图三态 + Markdown 渲染**：差异工具栏分段控件切换 **对照**（前后并排，默认）/ **变更前** / **变更后**——单侧模式将变更前（或后）的完整内容全宽单栏渲染，无空档；对照模式下双列分隔条可拖拽调整占比（20%–80%），会话内保持。**Markdown 文件（.md/.markdown）额外提供「渲染」档**：将变更后内容按 Markdown 排版渲染（标题/列表/引用/表格/围栏代码高亮；渲染器零依赖且安全——原始 HTML 转义、链接 scheme 白名单）。
- **新增/删除文件直接展示**：纯新增（`--- /dev/null` 形态）单栏全宽直接展示创建后的完整文件内容（含行号）——纯删除（`+++ /dev/null`）对称地展示被删文件的完整内容并带「已删除」徽标；0 字节空文件显示「文件为空」。
- **语法高亮**：按文件类型着色关键字/字符串/注释/数字等；整块 tokenize 后按行渲染，跨行注释与多行字符串保持正确。颜色复用宿主主题 token（亮/暗自适应）；高亮开关与代码字号可在设置中调整（语言子集见[已知限制](#已知限制)）。
- **上下文折叠**：连续 12 行以上未变更的上下文段折叠为「… N 行未变更」横条，点击展开/收起；可在设置关闭。三种视图模式下折叠坐标均按各自内容流独立计算。
- **设置项**：代码字号（10–16px）、语法高亮开关、上下文折叠开关，独立于显示模式档位。

### 数据保鲜与边界行为

- **数据自动保鲜，零操作**：进入会话自动加载状态快照、静默轮询（间隔由主机下发，默认 30s，不重叠请求）、agent 完成一个回合后立即刷新（此时工作区最可能已变化）、断线重连 resync、面板内手动刷新。
- **确定性降级**：非 git 目录、无 cwd、git 缺失、超时、巨型仓库等边界显示稳定降级态——不崩溃、不刷屏。
- **零 agent 影响**：不给模型新增工具、不写会话事件，从不改变 agent 行为。Git 中心的写操作（暂存/提交/分支/拉取）均由用户从 UI 主动发起。

## 安装

需要已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）且使用 `web` profile。

```sh
# 从 npm registry 安装。
dsh plugin --profile web add dsh-git-ui
```

安装后**重启 dsh web**。在 git 仓库目录打开会话，头部即出现分支 Pill。

验证安装：

```sh
cat ~/.dsh/profiles/web/package.json   # dsh.profile.bundles 中应包含 dsh-git-ui
```

卸载：

```sh
dsh plugin --profile web remove dsh-git-ui
```

> 本地开发安装（把本仓库链接进 profile）：`dsh plugin --profile web add ./`。
> 本地 tgz / 目录 / GitHub 直装（`file:...tgz`、`github:...`）会把包以 symlink
> 方式装进 profile，Node 沿真实路径解析时无法触达宿主提供的 `@deepseek-ai/*`
> peer 依赖。本地安装时请保持本仓库 `node_modules/@deepseek-ai/*` 的 peer 链接
> 存在（步骤见 [开发](#开发)）。

## 使用方式

1. 打开一个工作目录位于 git 仓库内的会话。
2. 随时扫一眼头部 Pill——无需任何操作。
3. 点击 Pill 查看仓库根目录、计数、最近提交与变更文件；点 `刷新` 立即重新检查，或打开 Git 中心进行完整变更管理与历史浏览。

每个会话显示**自己工作目录**的 Git 状态；非仓库会话显示弱化占位而非 Pill。

## 配置（可选）

默认零配置开箱即用。高级用户可在 profile 的 `cordis.patch.yml` 中覆盖插件配置（后层覆盖，整行替换 `config`）：

```yaml
- id: git-ui
  config:
    defaultRefreshIntervalMs: 60000   # 轮询间隔（毫秒）；0 = 关闭轮询
    maxChanges: 200                   # 快照中变更文件条数上限
    timeoutMs: 3000                   # 单条 git 命令超时（毫秒）
    maxStatusBytes: 8388608           # status 输出上限，超出截断
    dshHome: /path/to/harness-home    # 可选：Harness home（默认 $DSH_HOME → ~/.dsh）
                                      # 插件数据存放于 <home>/plugin-data/dsh-git-ui/
```

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- dsh `>= 0.1.0-rc`（开发者预览版）
- 主机可执行 `git`（插件通过子进程调用 git 命令）

## 已知限制

- 仅展示会话工作目录的 Git 状态。历史页的过滤树列出远程分支、领先/落后与手动拉取，但不暴露 push / pull / merge。
- 轮询式刷新（默认 30s）；基于文件监听的事件推送为规划中的扩展。
- 变更文件列表有上限（`maxChanges`）；未跟踪目录内部文件逐个枚举。status 输出超过内存上限（默认 4 MiB）时会从私有 spill 文件恢复完整输出，**计数保持精确**——仅当 spill 上限（64 MiB）也被突破时才回退为近似（`truncated: true`）。
- 浏览器只传 `sessionId`，不传路径；主机解析权威 cwd 并执行 git 命令（写操作用 `--` 路径分隔、拒绝绝对路径与 `..` 逃逸）。
- **Turn 工作记录**：bash 动态构造写目标（`$(...)`、glob、`find -exec`、`eval`）不可静态提取，落入「外部」且带 `≈` 推断标记（根治路径待上游沙箱提供 per-turn 权威写集，插件已预留接口缝）；冷 subagent / 冷兄弟会话（未加载）跳过对应归因——兄弟归因随观测时间线固化（已判定不漂移），但从未被查询判定过的兄弟写入仍落「外部」；兄弟会话识别经 realpath 归一 + 仓库子目录纳入；观测时间线每会话上限 2000 条（裁剪最旧），且在一个轮询间隔内出现又消失的外部变更在宿主重启后无法重建；turn 边界为首次观测点近似（轮询粒度内的先写后还原不可分）；早于首个 turn 的变更无归属窗口；人工改判为仓库级（跨会话生效），不随会话回收。
- 语法高亮为 bundle 预算裁剪的语言子集（TypeScript/JS 族、JSON/YAML/TOML/INI、Markdown、XML/HTML、CSS/SCSS/LESS、Python、Shell、Java、Go、Rust、C、C#、Kotlin、SQL、Makefile）。C++ 以 C grammar 近似、HTML 以 XML grammar 近似、SCSS/LESS 以 CSS grammar 近似（基础 token 正确，语言特有结构回落纯文本）；PHP、Swift、Ruby、Lua 等未注册语言**整体回落纯文本**（仍为等宽字体、不报错）。
- Markdown 渲染视图的 mermaid 图为**零依赖轻量子集**（完整 mermaid 运行时 ~1MB+，与 bundle 预算冲突）：支持 flowchart/graph（TD/LR、节点形状、边标签、链式、subgraph）与 sequenceDiagram（participant、消息箭头、Note over）；其余图形类型与未覆盖语法在块中心显示「图表解析失败」并可切换源码查看。
- 设置持久化于宿主磁盘；若 host RPC 不可达（降级），设置仅停留在内存态（本次会话有效）。

## 开发

```sh
pnpm install
# 把宿主提供的 peer 依赖链接进仓库，本地 `dsh plugin --profile web add ./` 才能解析：
# pnpm 以 symlink 把包装进 profile，Node 沿真实路径回到本仓库，
# 因此 node_modules/@deepseek-ai/* 需要指向宿主的 fallback 目录。
mkdir -p node_modules/@deepseek-ai
for p in "$HOME"/.dsh/profiles/node_modules/@deepseek-ai/*; do
  ln -sfn "$p" "node_modules/@deepseek-ai/$(basename "$p")"
done
pnpm run typecheck
pnpm test
pnpm run build        # host（esbuild ESM，禁止压缩）+ client（ModuleLoader factory 闭包）
dsh plugin --profile web add ./   # 本地安装；重启 dsh web 验证
```

### 架构

插件采用分层架构，将 dsh 平台隔离在窄适配层之后，dsh API 演进时业务逻辑零改动：

```mermaid
flowchart TB
    subgraph Biz["业务层 — 零 dsh import"]
        HostBiz["src/host/ · core / actions / queries / parser"]
        ClientBiz["src/client/ · controller / GitPill / GitCenter"]
    end
    subgraph Contracts["契约层 — 稳定接口"]
        C["src/contracts/ · host-endpoints / client-platform / ui-primitives"]
    end
    subgraph Adapters["适配层 — 唯一感知 dsh 的代码"]
        A["src/adapters/dsh/ · client-adapter / ui-primitives / types"]
    end
    HostBiz --> C
    ClientBiz --> C
    C --> A
    A --> DSH["dsh 平台 · cordis / typert / ui-primitives"]
```

- `src/contracts/` 定义插件自己的稳定接口（零 dsh import）。
- `src/host/` 与 `src/client/` 基于这些接口实现业务逻辑。
- `src/adapters/dsh/` 是**唯一** import `@deepseek-ai/*` 的地方；
  dsh 升级只需修改此处。

## 许可证

[MIT](LICENSE)