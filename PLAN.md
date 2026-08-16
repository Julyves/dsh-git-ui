# dsh-git-status — 可行性研究 & 工程结构方案

> 结论：**独立仓库实现完全可行，无需 deepseek-harness monorepo 构建机制。**
> 本文件汇总源码级核实结论（基于 deepseek-harness checkout，0.1.0-rc.x 系）与独立仓库工程结构。
> 2026-08-16 复审修订：修正 §2.2 数据通道选型错误，补充 browser Remote 通道、构建禁令、peerDeps 机制等核实事实（见 §6）。

---

## 1. 项目背景与目标（恢复自规划会话）

为 DeepSeek Harness (dsh) 开发 Web UI Git 信息可视化插件：在会话头部显示当前工程（会话工作目录）的
**分支、HEAD 提交、脏状态计数（已暂存/已修改/未跟踪）、领先/落后**，点击弹出详情面板（仓库根目录、
最近 5 条提交、变更文件、手动刷新、检查时间）。

约束（规划会话中确定的显式决定）：

- 纯 UI 展示：不产生模型可见输入（无 session 事件）、不给模型新增工具。
- 目标目录 = 会话 `cwd`（live `ctx.sessions.get` / 冷会话 `sessionPersistence.inspect`）。
- 数据获取 = 轮询 + 手动刷新 + 重连 resync；轮询间隔由主机 Config 下发（浏览器端无 config 通道）。
- 展示范围：分支/HEAD/计数/领先落后/最近提交/变更文件；远程 URL 等留待扩展。

原规划（monorepo 内三包：`packages/host/git-info` + `packages/client/ui-git` + `packages/bundle/git-ui`）
的功能面全部保留，但**工程载体改为独立仓库 `dsh-git-status`**（GitHub: `Julyves/dsh-git-status`）。

---

## 2. 可行性研究：关键机制（全部源码级核实）

### 2.1 host 侧：Remote 服务不依赖 typert 生成器 ✅

- `@Remote` 装饰器 + `TypertRemoteService` 基类来自运行时包 `@deepseek-ai/dsh-typert-protocol`
  （npm 已有 `0.1.0-rc.6`）。装饰器机制 = 纯运行时 metadata：`addInitializer` 把方法名写入模块私有
  WeakMap，`remoteMethods(service)` 读取。
- gateway（`packages/api/gateway`）对 `/api` 请求的处理链（`connection.rpc.intercept('/api', ...)`）：
  1. `claimsEndpoint`：`ctx.typert.local`（strict 注册）优先，否则 **`srcClaims`** —— 扫描
     `ctx.reflect.props` 中所有 service，读 `typertRemote` binding + `remoteMethods()` 收集端点；
  2. `resolveDescriptor`：strict 注册优先，无则 **SRC fallback**（`resolveSrcDescriptor`：按
     namespace 匹配 binding、按方法名匹配 marker，参数 codec 为宽松 `src-json`）；
  3. 调用前 `assertExactArguments`（按 **函数参数名反射** 校验参数名/数量）+ `validateBinding`。
  → **host 侧零生成工件完全可用**（`gitInfo/snapshot` 端点自动暴露）。
- typert-loader 源码明示：无 `./typert` 导出的包**静默跳过**；手写 wire schema
  （`ctx.typert.register()`）是官方支持路径。`./typert` / `./remote` 工件只是构建期生成的
  zod 校验增强层，可选。
- cordis 插件形态确认（`vendor/cordis/src/registry.ts`）：`resolve(plugin)` 支持
  **function / class / { apply } 对象**；类插件携带 `static inject` 与 `static Config`
  （schemastery），patch 行 `config` 传入构造。message-feedback 为同款先例。
- ⚠️ **host 构建禁令**：SRC 模式依赖函数参数名反射（`methodParameterNames`）做参数校验与 wire 命名
  → **host 产物禁止 minify/参数重命名**（tsc 编译天然保留；若用 esbuild 须 `minify: false`）。
  Remote 方法保持单 `request` 对象参数签名（message-feedback 同款），参数名稳定。

### 2.2 browser 侧：client bundle 不需要 monorepo 构建机制 ✅（数据通道经复审修正）

- 浏览器端插件格式 = **单文件闭包**：`window.__ModuleLoader__.load({ id, factory(require) })`，
  依赖外部化——`require()` 由 loader 模块表解析（平台模块表 `packages/client/web/src/platform.ts`
  含 `react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/cordis`、`dsh-client-ui-slots`、
  `dsh-client-web-react`、`dsh-client-ui-primitives`、`dsh-client-ui-attachment`、
  `dsh-client-schema-form`）。
- `dsh-client-modules` 节点半按包的 `exports["./client"]` 解析产物路径，服务
  `/plugins/<包名>/client.js`（**id = loader entry name = patch 行 name = 包名**，scope 斜杠可含）。
  产物路径可以是任意文件（社区先例 `dsh-provider-quick-config` 的 `exports["./client"]` 直接指向
  手写 `src/client.js`）。⚠️ 产物文件必须存在：缺失抛 `MissingClientBundleError`（ENOENT）
  → tgz 分发必须包含构建产物；git 安装必须由 `prepare` 生成。
- **浏览器→host 数据通道（修正版）**：`ctx.api.*`（AbstractApiClient）是**静态 RpcMethodMap**
  （`host.describe`、`sessions.*`、`settings.*`、`llm.*` 等预定义 schema 映射），**不能**调用任意
  namespace —— 社区插件能用 `api.settings/llm` 只因它们在预定义 wire 中。新 Remote namespace 的
  正确通道是 **`ctx.remote.$mount(contribution)`**：
  1. `ctx.remote` 服务 = `ClientRemoteService`（`@deepseek-ai/dsh-api-gateway` 的 client 半，
     `super(ctx, 'remote')`，inject `['typert', 'connection']`；web-app 组合已装配 `api-gateway` 行）；
  2. contribution = 手写 `TypertRemoteContribution`（descriptors 数组：`namespace: 'gitInfo'`、
     `method: 'snapshot'`、参数/结果 codec）—— ⚠️ **必须 strict mode + zod schema**
     （`requireStrictDescriptor` 强制 `mode: 'strict'`，调用时 `codec.schema.parse` 校验）；
  3. 挂载后 `ctx.remote.gitInfo.snapshot(...)` → `connection.rpc.call('/api', 'gitInfo/snapshot',
     { args })` → gateway SRC 解析（§2.1）→ host 服务执行。
  → 无需**生成器**，但需要**手写等价贡献**（含 zod schema；zod 内联进 client bundle 即可——
  平台外部表不含 zod，monorepo 的 remote-client 工件同样内联；react 等平台模块则**必须外部化**）。
- 浏览器端服务链（client 插件 fiber inject）：`slots`（ui-slots 平台模块）、`remote`
  （api-gateway client）、`locale`（dsh-client-locale）、`sessions`（ui-conversation 提供，
  实现期核实）；slot 目标 `conversation.session.header.utilities`（list/session 作用域，
  ui-conversation `apply.ts` 声明）✓。

### 2.3 bundle 安装与分发 ✅

- `dsh plugin --profile web add <path|tgz|github:...>` = pnpm forwarder：在 profile 目录执行
  `pnpm add`，然后按**已安装依赖的 `dsh.bundle` manifest** 重算 `dsh.profile.bundles` 层栈
  （`apps/cli/src/plugin.ts` + `@deepseek-ai/dsh-app-boot`）。
- profile 模板（`dsh-app-boot/src/profile.ts`）：`web = ['@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app']`；pnpm-workspace.yaml = `nodeLinker: hoisted` +
  `autoInstallPeers: false` —— **peerDeps 缺失时 fallback 到 dsh 安装自带的 node_modules**
  （"healed" fallback，共享安装级单一 cordis 实例）→ 独立插件 peerDeps 由宿主提供，
  **不会**从 npm 拉到过时版本。版本范围按社区模式 `">=0.0.1-rc.1 <0.2.0"`。
- 分发三形态（publish.md）：
  - 本地目录/链接：`dsh plugin --profile web add ./dsh-git-status`（开发期最方便）
  - **tgz**：`pnpm pack` 后 `add file:...tgz`（**免构建权限，推荐发布形态**）
  - git：`add github:Julyves/dsh-git-status#<sha>` → 需自包含 `prepare` 脚本（tsc/esbuild，
    不得依赖 monorepo）+ 用户 `allowBuilds` 白名单（pnpm ≥10）
- **patch 行**：单包双 manifest（`dsh.bundle` + `dsh.client`）时**一行 insert 即可**
  （社区 `dsh-provider-quick-config` 先例）：
  ```yaml
  - insert:
      - id: git-status
        name: dsh-git-status        # 必须是包名（loader entry name / client.js URL 的依据）
        config: { ... }             # host Config（schemastery 校验）
  ```
  ⚠️ 不要为同一包插两行（服务类实例化两次 → 同名服务注册冲突）。

### 2.4 测试基座

- monorepo 的 assembled-boot / fixture / snapshot golden 是仓库内部件，独立仓库不复用。
- 独立仓库用 **vitest + jsdom + 临时 `git init` 仓库**自测：parser 纯函数、controller 状态机
  （fake timers）、host 服务契约（真实 subprocess + 临时仓库各形态）；全链路靠
  `dsh plugin add` + 手动验收（本仓库自身就是 git 仓库，天然可验证）。

---

## 3. 工程结构方案（单包，社区形态）

参照社区成熟先例：`dsh-plugin-check`（TS + tsc 构建 + peerDeps 策略）与
`dsh-provider-quick-config`（单包同时承载 `dsh.bundle` + `dsh.client` 双 manifest）。

```
dsh-git-status/
├── package.json          # 单包：dsh.bundle.patch + dsh.client；exports "." (host) / "./client"
├── cordis.patch.yml      # 单行 insert（id: git-status / name: dsh-git-status / config）
├── tsconfig.json         # 严格模式；标准 decorators 开启；不压缩参数名
├── build.mjs             # 自包含构建：tsc 编译 host + esbuild 单文件打包 client（prepare 可复现）
├── src/
│   ├── host/
│   │   ├── index.ts      # GitStatusService extends TypertRemoteService；@Remote('snapshot')；static inject/Config
│   │   ├── parser.ts     # git status -z --branch / log 输出纯解析（无副作用，可 100% 覆盖）
│   │   └── types.ts      # GitSnapshot / GitSnapshotFailure 判别联合 / GitCommit / GitChange
│   ├── client/
│   │   ├── index.ts      # apply(ctx)：locale 注册 + ctx.remote.$mount(gitInfoRemote) + slots.inject(...)
│   │   ├── remote.ts     # 手写 TypertRemoteContribution（strict zod schema，与 host types 同步）
│   │   ├── controller.ts # GitController（每会话：单飞、轮询、resync、dispose）
│   │   ├── GitPill.tsx   # pill + popup（React.createElement 或轻量 JSX 构建）
│   │   └── locales.ts    # zh/en 文案（NS: git）
│   └── shared/           # host/client 共享纯类型（避免跨半 import 拖入 Node 依赖）
├── tests/
│   ├── parser.spec.ts
│   ├── controller.spec.ts
│   └── service.spec.ts   # 真实 subprocess + 临时 git init 仓库契约测试
└── README.md             # Model Experience + 安装说明（tgz / github:）+ Known Limitations
```

### 3.1 关键设计决策（复审修订版）

| 决策点 | 方案 | 理由 |
|---|---|---|
| 包形态 | 单包（host + client 同包，双 manifest） | 社区先例；`dsh plugin add` 一次装完；patch 单行 insert |
| host 构建 | tsc（严格模式，**禁止 minify**） | 避开 tsdown/typert 生成器；SRC 参数反射要求保留参数名 |
| client 构建 | esbuild 单文件闭包（external: 平台模块；inline: zod） | `window.__ModuleLoader__.load` 格式；prepare 自包含 |
| Remote 数据面 | `ctx.remote.$mount(手写 contribution)` + `ctx.remote.gitInfo.snapshot()` | 新 namespace 唯一通道；`ctx.api` 是静态表不可用 |
| contribution 形态 | 手写 `TypertRemoteContribution`（strict + zod schema） | `requireStrictDescriptor` 强制；zod 内联无共享 identity 需求 |
| typert 工件 | 不提供 `./typert`/`./remote` 导出 | loader 静默跳过；gateway SRC fallback 可用 |
| 轮询间隔 | host Config（schemastery）下发 `refreshIntervalMs` | 沿用规划；浏览器无 config 通道 |
| peerDeps | `>=0.0.1-rc.1 <0.2.0`，宿主 hoisted fallback 提供 | npm 发布版过时；profile 机制保证解析到宿主新版 |
| 测试 | vitest + jsdom + 真实 git 子进程 | 独立仓库自洽；不做 monorepo snapshot golden |
| 分发 | tgz 为主（`pnpm pack`，含构建产物），git+prepare 为辅 | tgz 免 allowBuilds；产物必须随包存在 |

### 3.2 数据模型（沿用规划，微调命名）

```ts
GitSnapshotResult = { ok: true; value: GitSnapshot } | { ok: false; error: GitSnapshotFailure }
GitSnapshotFailure =
  | { code: 'session-not-found'; sessionId }
  | { code: 'cwd-unavailable'; sessionId }
  | { code: 'path-not-found'; path }
  | { code: 'git-unavailable'; detail: string }
  | { code: 'timeout' }
  | { code: 'not-a-git-repo' }
GitSnapshot = {
  root, branch, head, unborn, dirty,
  staged, modified, untracked, ahead, behind,
  lastCommit?, recentCommits, changes, truncated,
  refreshIntervalMs, checkedAt,
}
GitCommit = { hash, shortHash, subject, author, dateIso }
GitChange = { path, status: 'added'|'modified'|'deleted'|'renamed'|'untracked'|'conflicted'|'typechange', staged }
```

### 3.3 Host Config（schemastery）

`timeoutMs`(5000)、`maxStatusBytes`(4 MiB)、`maxChanges`(100)、`defaultRefreshIntervalMs`(30000，0=关轮询)。

### 3.4 实施顺序

1. 仓库骨架：package.json / tsconfig / cordis.patch.yml / build.mjs / vitest
2. host 半：types → parser（含测试）→ GitStatusService（@Remote('snapshot')，契约测试）
3. client 半：remote.ts（手写 contribution）→ controller（测试）→ UI 组件 → apply/slots/locales
4. 构建链：tsc + esbuild 单文件 bundle；`dsh plugin --profile web add ./` 本地安装验收
5. 分发：`pnpm pack` → tgz 安装复验；README + LICENSE；首次 commit & push（补 GitHub topics）

---

## 4. 边界与失败模式（沿用规划）

- 无 cwd 会话 → 不渲染；cwd 被删 → `path-not-found` 降级，下轮轮询自动恢复；非仓库 → 弱化文案；
  detached/unborn 各自文案；git 未安装 → `git-unavailable`；超时 → `timeout` 重试；
  巨型仓库超 `maxStatusBytes` → `truncated: true` 近似标注。
- 并发：单飞防重叠；轮询与手动刷新同一路径；控制器随会话/插件生命周期 dispose（定时器 + abort）。
- 安全：浏览器只传 `sessionId`；host 解析权威 cwd 并 realpath；只读 git 命令；无路径注入面。

---

## 5. 待实现期核实的小项

- `@deepseek-ai/dsh-client-ui-primitives` 的具体导出（Pill/HoverCard/StateDot 可用性）与
  `conversation.session.header.utilities` 的 PropsRuntime 类型面（对照 `ui-message-feedback`
  的 `slots.ts` 模板）。
- 浏览器端 `sessions` 服务（`SessionSummary.cwd` 来源）的提供者与 hook 面
  （`useSessions` 或 `ctx.sessions`）——ui-conversation 的 slots 注入面为准。
- 手写 contribution 的 zod schema 与 host 类型的一致性维护（测试覆盖；必要时加 invariant 断言）。
- npm 上 `@deepseek-ai/dsh-typert-protocol` 与 monorepo 源码的 API 差异（peerDeps 解析到宿主新版，
  以宿主为准；实现期用本地 monorepo checkout 的类型验证）。
- client bundle 的 `inject` 数组（dsh.client 声明）应列出哪些宿主包（模块表预取边）——对照
  `ui-message-feedback`：`['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-conversation']`，独立仓库版本
  需以实际 fiber inject 为准（remote 服务在 api-gateway，不必挂 api-remotes 装配包）。

---

## 6. 复审修正记录（2026-08-16）

1. **§2.2 数据通道错误**：原稿"`ctx.api.gitInfo.snapshot()` 泛化 RPC"不成立——`AbstractApiClient`
   是静态 `RpcMethodMap`（预定义 schema 映射），不可调任意 namespace。已改为
   `ctx.remote.$mount(手写 contribution)` → `connection.rpc.call('/api', endpoint)` 通道
   （源码：`packages/client/connection/src/client/api.ts`、`packages/host/apiproxy/src/fetch/client.ts`、
   `packages/api/gateway/src/client/index.ts`）。
2. **contribution 必须 strict + zod schema**（`requireStrictDescriptor`，`packages/api/gateway/src/client/index.ts:549`）
   —— 原稿"无需工件"改为"手写等价贡献"。
3. **host 构建禁止 minify**（SRC 参数名反射，`packages/api/gateway/src/index.ts` 的
   `methodParameterNames`/`assertExactArguments`）。
4. **peerDeps 机制精确化**：profile `nodeLinker: hoisted` + `autoInstallPeers: false` +
   安装自带 node_modules fallback（`packages/boot/app-boot/src/profile.ts`）——不会拉到 npm 旧版。
5. **patch 单行 insert**（单包双 manifest；`/plugins/<包名>/client.js`；load id = 包名；
   同包两行会服务类重复注册冲突）。
6. **client 产物必须随包存在**（`MissingClientBundleError`，`packages/client/modules/src/index.ts`）。
7. **平台模块表确认**：react/react-dom/jsx-runtime 为平台模块（外部化），zod 可内联。
8. **浏览器服务链确认**：`remote` 服务 = api-gateway client（web-app 组合已装配）；
   `slots` = ui-slots 平台模块；slot 目标 `conversation.session.header.utilities`
   （list/session 作用域）源码确认。
