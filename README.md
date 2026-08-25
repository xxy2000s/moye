# Moye

Moye 是一个面向代码研发任务的全自动、可恢复、可追踪 Harness。它以 Task 为业务聚合根，协调 Agent、Daemon、Worktree、测试、Review、Git 合并和知识沉淀，目标是让一次研发任务从需求进入到主干合入形成可验证闭环。

当前状态：**Core v2 PoC 已用真实 Codex、Restate、隔离 Git 与受信任测试完成 16 个独立产品场景，并通过统一实时审计（0 Finding，报告摘要 `sha256:96ad9fc9…de86`）。范围包括 Happy Path、Finding 驱动 Repair/Replan、Test 与 Role `UNKNOWN` 对账、Worker 中断、Git Candidate/Merge 回执未知、失败 Closure/Archive、预算耗尽、Observer 超时非阻塞及旧 Generation fencing；成功和确定失败 Task 都唯一归档，LIVE-001～004 也已通过 append-only recovery successor 合法收敛。Board 可按真实 outcome、Workflow 与验收历史筛选和下钻。这里证明的是本地单 Workflow/受控故障 PoC 的关键状态机闭环，不代表生产级 Core 已完成。**

Agent Session Evidence M1 也已完成本地产品验收：新 Codex/Claude Role 在执行前冻结 Prompt Envelope，Provider 原生 Session 被规范化为受管 Transcript；真实七角色 Capture 在 Manifest 回执丢失后由 Restate 恢复且没有重跑 Agent；LIVE-006 的七个旧 Session 通过 append-only Sidecar 补全，原 Projection Digest 保持不变。统一报告摘要为 `sha256:7a9e335a…55854`。这仍不代表生产鉴权、加密保留策略、远端 Artifact Store 或 Provider 未暴露/加密 reasoning 已完成。

Framework MVP 的公共边界已由 [ADR-0008](./docs/knowledge/decisions/adr/0008-publish-framework-mvp-as-versioned-umbrella-package.md) 冻结：首版采用 `moye@0.1.0` umbrella package，通过 `moye/core`、`moye/client`、`moye/plugin-sdk` 和 CLI 提供公共入口，Restate Workflow/Projection 写入口保持私有。M2 仍在实施中；在外部示例、分发和真实产品矩阵完成前，不宣称 Framework MVP 已发布。

项目 Manifest v1 与消费级 Client/CLI 已可驱动真实本地任务：`moye init`、`doctor`、`project validate`、`task start/status/watch/open` 会自动冻结 clean Git HEAD、目标 ref、受信任测试、Runner、仓库外受管 Artifact Root 和页面链接，用户不构造 Workflow Input。修正版真实外部任务 `TASK-FRAMEWORK-20260825224122` 已由七个真实 Role、Trusted Runner、双父 Merge、Closure 和 Archive 唯一完成。Plugin SDK v1 也已定义七类 Adapter、显式 capability negotiation、统一 contract suite 和 UNKNOWN/Reconcile 边界；第三方 Plugin 没有 Task 状态写入口。安装包与容器仍由后续 M2 Task 交付。

## 当前目标

第一阶段不构建完整平台，而是验证最关键的 Task Runtime 能力：

```text
接收 Task
  → 创建 Step / Attempt
  → 执行 Durable Agent Step
  → 保存 Checkpoint
  → 强制中断 Worker
  → 由新 Worker 恢复
  → 验证副作用不重复
  → 得到唯一、可解释的结束状态
```

PoC 使用 Restate。真实 `SIGKILL` 恢复测试已经验证“目录移动完成但 Step 尚未确认”的未知结果可以自动对账，详见 [验证记录](./docs/delivery/tasks/archive/2026-08-20-TASK-0001/verification.md)。该决策仅适用于第一轮验证，不代表最终生产选型，详见 [ADR-0001](./docs/knowledge/decisions/adr/0001-use-restate-for-task-runtime-poc.md)。

## 快速验证

### 开发执行档位

仓库 Agent 默认使用 `auto` 选择满足风险约束的最低档位：`lite` 用于静态视觉、文案和其他低风险局部变更，只要求定向验证而不创建 Task/Docs Impact/Seal；`standard` 用于普通功能和 Bug，保留最小 Task、Context Route、Docs Impact 与单 Result Commit；`full` 用于 Core、持久化、副作用、安全、迁移和架构变更，执行完整闭环。Agent 开始工作时必须声明档位，执行中发现风险扩大只能升级。精确白名单和门禁见 [AGENTS.md](./AGENTS.md) 与 [moye-task-control Skill](./.agents/skills/moye-task-control/SKILL.md)。

### 第一次使用：一条命令体验

需要 Node.js 22 和正在运行的 Docker Desktop：

```bash
npm install
npm run demo
```

命令会自动分配空闲端口、启动 Restate，并在隔离 Git Fixture 中用确定性 Fake Agent 完成一次 Coding Task：创建 Worktree、修改文件、提交、验证、合入和归档。它不会修改 Moye 仓库。打开终端中 `项目看板:` 后面的 URL，点击“已归档”列中的 Task，可以核对合法边、实际 Event 转换、Attempt/Evidence 和归档终态；按 `Ctrl-C` 停止，演示数据保留在 `.moye-runtime/demo`。

要让本机真实 Agent 完成同一个隔离任务，使用：

```bash
npm run demo:codex
# 或
npm run demo:claude
```

脚本会在任务派发后立即打印看板地址，无需等待 Agent 结束。打开进行中的 Task 后，`Agent Events` 会逐行增长；Fake、真实 Codex 和真实 Claude 会在页面明确标识。真实命令使用当前 CLI 的既有认证，但不会修改用户级 Claude Settings 或 Codex 配置。

需要同时体验标准 Trace 时使用：

```bash
npm run demo:trace
```

该命令通过可选 Compose Profile 启动本地 Phoenix，再运行同一个隔离 Demo。Moye Board 会展示稳定 Trace ID、Phoenix 入口和 Agent Events；点击 `查看 Agent Events` 后可按对话、工具调用、工具结果、系统和错误筛选，运行中自动刷新，完成后仍在页面弹窗中通过 cursor 读取全部事件。Phoenix 只负责技术诊断，默认 `npm run demo` 不启动它；停止 Trace 后端使用 `npm run trace:down`。

### 验证实现

需要 Node.js 22、Docker 和 Ruby。安装依赖后运行完整门禁：

```bash
npm install
npm run check
npm run test:e2e
```

`test:e2e` 会启动隔离的 Restate 1.7.4 容器、强杀 Service、重启并验证唯一归档，结束后自动清理容器。开发启动、服务注册、CLI 和看板操作见 [本地 PoC Runbook](./docs/knowledge/guidance/runbooks/local-restate-poc.md)。

启动 Restate、注册 Moye 服务后，Board 是只读审计界面，不创建或推进 Task。`create/status/wait` 会先通过 TaskAuthority 定位唯一 Workflow；输入含 `objective + repositoryRoot + runnerKind` 时 `create` 发起真实 Coding Task，否则保持兼容通用 Task。产品入口只接受 `CODEX_EXEC` 或 `CLAUDE_PRINT`，不会回落 Fake。

```bash
npm run cli -- create --file /absolute/path/to/live-task.json
npm run cli -- status TASK-LIVE-EXAMPLE
npm run cli -- wait TASK-LIVE-EXAMPLE --timeout-ms 900000
```

Core v2 完整研发生命周期使用独立 CLI 命令；Web 仍是只读追踪面：

```bash
npm run cli -- core-v2-start --file /absolute/path/to/core-v2-task.json
npm run cli -- core-v2-status TASK-CORE-V2-EXAMPLE
# 仅当状态明确为 WAITING_RECONCILE 且已有外部证据时：
npm run cli -- core-v2-reconcile TASK-CORE-V2-EXAMPLE \
  --token 'sha256:...' --action NOT_APPLIED --evidence 'trusted ledger reference'
```

真实、隔离、可重复的产品验收命令是：

```bash
npm run acceptance:live
# Core v2 真实 Happy Path；需要已注册且 allowlist 覆盖验收根目录的 Service
npm run acceptance:core-v2
# Core v2 真实 Finding/Repair/Replan 场景；只允许在专用验收 Service 启用
npm run acceptance:core-v2:faults
# Core v2 真实 Test UNKNOWN、Worker 中断与 Git/Merge 回执未知矩阵
npm run acceptance:core-v2:recovery
# Core v2 真实预算、Observer/Knowledge 超时与 stale fencing 矩阵
npm run acceptance:core-v2:guards
# 串行执行上述四套 suite 并运行统一实时审计
npm run acceptance:core-v2:matrix
# 对调用方显式列出的 suite/scenario 做实时 Runtime、Board、Git、Artifact 与文档图 fail-closed 审计
npm run acceptance:core-v2:audit -- --file /absolute/path/to/audit-input.json --output /absolute/path/to/audit-report.json
# 显式绑定一次真实 Session Capture Recovery summary 后，串行验证真实 Codex、Claude、恢复、历史补全与 Board API
MOYE_AGENT_SESSION_RECOVERY_SUMMARY=/absolute/path/to/session-capture-recovery/evidence-summary.json \
MOYE_AGENT_SESSION_ACCEPTANCE_BOARD=http://127.0.0.1:3000 \
npm run acceptance:agent-sessions
# 校验七类内建 Plugin bridge、公共 capability 与 UNKNOWN/Reconcile 契约
npm run acceptance:framework:plugins
```

Core v2 四个 suite 和统一 matrix 入口不会使用 Fake/Mock/Scenario Adapter：每个场景创建新的持久化运行目录和独立 Workflow key，调用真实 Codex、隔离 Git、Trusted Runner、适用时的双父 Merge、Closure 和 Archive，并从 Projection、Trace、Role Events、Manifest 与 Git DAG 生成 Evidence Summary。故障、恢复和预算命令要求 Service 显式设置 `MOYE_ACCEPTANCE_FAULT_INJECTION=enabled`；普通 Service 会在 TaskAuthority claim 前拒绝 `acceptanceControl` 或 `recoveryControl`。审计命令不扫描目录挑选“最新成功”，只接受显式 Manifest，并重新查询 Restate、TaskAuthority、Board、Git 对象、Artifact 摘要和 Document Graph；任何缺失、重复或实时漂移都会非零退出。这些命令消耗真实模型额度，不能用单元测试结果替代。

推荐先启动带持久化数据卷的本地 Runtime，再注册 Moye Service：

```bash
npm run runtime:up
npm run runtime:status
```

脚本会自动兼容 `docker compose` 与 `docker-compose`；`runtime:down` 只停止 Restate，不删除 `moye_restate_data` 数据卷。运行时包含两个本地入口：

- Restate Service Endpoint：默认 `9080`；
- Moye Project Board：默认 [http://localhost:3000](http://localhost:3000)。

CLI 统一使用 `npm run cli -- <command>`；项目 Agent 应使用 [moye-task-control Skill](./.agents/skills/moye-task-control/SKILL.md) 路由文档依赖和关闭门禁。

Bootstrap Task 的 `validate/create/close` 会在进入 Runtime 前校验冻结 `base_commit`；升级前遗留的已失败 Invocation 只能使用受限的 `recover-bootstrap-failure` successor 收敛，禁止删除 Invocation、直接编辑 Projection 或扫描 Git 伪造 Board 状态。

Board 总览保持四列业务分组，并在顶部提供 outcome、Workflow kind 与“项目任务/验收历史”筛选，以及最新成功归档 Task 的直达入口。每张 Task 卡片从自身 Domain Event History 派生开始时间、结束时间与 duration：首条 Event 是开始时间，只有完成 Archive 才显示结束时间，运行中 duration 使用 Board 投影时刻累计。`WAITING_RECONCILE`、`ARCHIVE_PENDING`、`ARCHIVE_FAILED`、`FAILED_TERMINAL` 和 `SUCCEEDED` 使用 Workflow 发布或 TaskAuthority 只读解析出的精确语义；筛选和时间展示都不写 ProjectBoard，也不推进 Task。新增 Core v2 验收输入使用显式 `acceptanceMetadata`，升级前历史记录只按受限 Task ID/标题约定显示兼容标签并标明来源。

Coding Task 出现在看板后，点击卡片会路由到可直达和刷新的全屏 `/tasks/<task_id>` Task Audit Page；右上角“返回项目”回到 `/`，浏览器 Back/Forward 同样有效。详情内容顶部固定为“画布”“角色与交付物”“Workflow 状态事实”“高级诊断”四个局部 Tab，首次进入默认画布，同一 Task 自动刷新保留当前 Tab；键盘可用左右方向键、Home 和 End 切换，窄屏横向滚动。四个 Tab 只重组现有只读事实，不创建第二套状态。页面 Header 只常驻 Task 身份、真实 Workflow kind、角色参与和结果摘要；画布 Tab 直接进入 Graph，不再重复 Workflow 说明与四格状态：

1. Projection 与 Event History 一致时只在 Graph 工具栏显示一个紧凑标识；不一致时才在画布前主动展开业务、Archive、整体落点与 Event 重建差异。四项完整状态事实固定保留在“Workflow 状态事实”Tab；
2. 一张完整状态机 Graph 画布：默认只强调本次实际路径和 Event sequence，Core v2、Coding 与基础 Task 使用各自紧凑几何；基础 Task 不绘制不存在的 Recovery 背景，其他 Workflow 的恢复/异常容器只包围相关节点簇。切换“完整状态机”后可核对 normal、Repair、Replan、Reconcile、failure、archive 全部合法边。未发生节点仍保留在 Definition 中但降低强调，不会冒充本次失败；窄屏保持节点可读并允许横向滚动，不继续缩小成不可读小字；
3. 点击节点才打开详情：桌面在画布右侧显示 Inspector，窄屏在底部显示 Bottom Sheet；有真实 Session 的节点先展示 Agent 活动、分类计数、最近事件预览和“查看全部 Agent Events”主入口，再按系统管控、Workflow 状态流转、本次节点路径、技术 Evidence 与完整合法转换分层。没有 Session 的 Workflow、Gate、Trusted Runner、Merge、Closure 与 Archive 节点会明确标记“系统执行节点”并展示对应控制事实，不补造 Agent。Domain Event 是 Workflow 写入的业务事实，不是 Agent 对话或工具日志；实际进入/离开路径始终可见，完整合法转换按需展开并把 traversed 边排在前面。`Esc` 关闭节点详情并把焦点还给节点；
4. 完整 Domain Event 使用纵向时间线逐条展示 sequence、业务摘要、`来源 → 目标`、event type 和 time；原始 detail 只在单条 disclosure 中按需显示，没有状态转换的业务事实会明确标记，不伪造 `from/to`。“实际路径”、执行实例、完整合法边、角色会话和高级诊断默认折叠，需要时再展开；
5. “角色与交付物”使用统一 Execution Ledger：Core v2 与 Coding Task 在桌面显示紧凑角色索引和一个选中角色详情，窄屏改为横向角色选择与单列详情，不再默认纵向展开全部 Session。选中角色只突出 Revision、Generation、Attempt、Verdict、摘要和直接交付物；完整 Session/Artifact ID、Digest、全部 Artifact Register 与 Coding Journey 按需展开。没有 Agent 的基础/Sealed Task 显示真实 Workflow、Result Commit、Task Package 与 Archive 系统事实，不渲染空角色卡，也不补造 Agent；
6. 每条 Context、Implementation、Self Review、Review、Replan 与 Docs Gate Session 都在同一个 Chatbot 弹窗中展示；可按对话、工具调用、工具结果、系统和错误筛选，运行中增量跟随；Events 不跳转下载。直接打开 `/tasks/<task_id>` 时会先读取该 Task Trace，不等待体积更大的项目 Board Projection。

Restate Journal、恢复建议、技术 Artifact 与原始事件收在“高级诊断”中。进入 Restate 的链接已经按 `CodingTaskWorkflow + task_id` 过滤；Restate 负责执行排障，Moye Board 才是任务业务视图。

历史材料有两个不同权威，不能混为一谈：`docs/delivery/tasks/archive/` 中的 Task Package 和关闭证据由 Git 长期保存；Board 卡片、Workflow Journal 和 Domain Event 属于 Restate Runtime。旧的临时容器没有挂载 `/restate-data`，容器被重建后那批 Runtime Projection/Journal 已不可恢复，但 Git 中的历史归档没有丢失。当前标准 Compose 已持久化 `/restate-data`；页面仍只展示真实 Runtime Projection，不扫描 Git 目录伪造运行历史。

也可以直接查询 JSON：

```bash
curl http://127.0.0.1:3000/api/tasks/<task_id>/trace
```

Trace 不会修改 Workflow 状态；业务 Projection、Restate Journal 与技术日志分别承担状态、恢复、诊断职责。OTLP 默认关闭；Prompt、Response、Tool Content 和 Raw Model IO 也全部默认关闭，且不会修改用户的 Claude/Codex 全局配置。

将 Git 中的 Backlog 文档显式同步到已启动的 ProjectBoard：

```bash
npm run cli -- backlog sync --dir docs/delivery/backlog --project moye
```

该命令先校验完整批次，再通过一次 ProjectBoard 调用幂等合并；源文件消失时默认保留运行时记录并在结果中报告，不会静默删除。

## 文档入口

阅读顺序：

1. [仓库 Agent 操作契约](./AGENTS.md)
2. [内部文档索引](./docs/README.md)
3. [总体架构](./docs/knowledge/current/architecture/overview.md)
4. [Task Runtime Kernel 详细设计](./docs/knowledge/current/architecture/task-runtime-kernel.md)
5. [当前 CodeMap](./docs/knowledge/current/codemap/README.md)

内部文档按资产角色收敛为四个入口：

- [Sources](./docs/sources/README.md)：Brainstorm、Finding、Incident、Research 和 Reference；
- [Delivery](./docs/delivery/README.md)：Backlog、Active Task 和 Archived Task；
- [Knowledge](./docs/knowledge/README.md)：ADR、Architecture、CodeMap、Pitfall 和 Runbook；
- [Meta](./docs/meta/README.md)：文档图谱、模板和治理入口。

目录决策见 [ADR-0002](./docs/knowledge/decisions/adr/0002-organize-docs-by-lifecycle-role.md)，控制机制见 [Document Control Plane](./docs/knowledge/current/architecture/document-control-plane.md)。

## 自举原则

Moye 使用自己定义的 Task、证据和知识治理原则建设自身：

- 先记录决策和不变量，再实现代码；
- Research 不直接成为 Architecture；
- 重要取舍先形成 ADR；
- 每次结构性代码变更同步更新 CodeMap；
- Source 经过 Backlog 转化为 Task，不把讨论或故障直接当作可执行任务；
- 真实故障形成 Incident，并拆出 Backlog；通用教训提升为 Pitfall；
- Agent 不依赖聊天历史理解仓库，仓库文档必须提供完整交接上下文；
- 文档和代码都必须明确区分“当前事实”和“规划目标”。

## 当前边界

本轮已经实现 Task/Archive Workflow、Core v2 真实多角色生命周期、两阶段 Sealed Result Commit、真实 Codex 与 Claude Print Adapter、版本化 Prompt Envelope、Provider Transcript Sidecar、Self Review、两次隔离 Review、Repair/Replan/Reconcile、成功/失败 Closure 与独立 Archive Effect、真实本地双父 Merge/Reconcile、停滞 Workflow 的窄化 successor、全部 Session Event 下钻、实际路径点亮的只读状态机 Graph、确定性 Observer、可选智能 Observer/Knowledge 旁路、精确 Board Projection、三层 Trace、OTLP 和统一内部 CLI。16 场景 Core v2 矩阵、Session Capture 故障恢复、历史 append-only 补全及真实 Codex/Claude 产品验收已经通过。消费级 Manifest/CLI/Plugin、容器分发和外部项目验收仍在 M2 实施；完整多 Daemon Lease/Fencing、远程 Git Provider/PR、鉴权、多租户、生产 Sandbox/密钥治理、跨节点 Artifact Store、Transcript Retention/Erasure，以及 Metrics/Logs/告警/SLO 等仍未实现，详见 [Core v2 Roadmap](./docs/delivery/core-v2-roadmap.md)。
