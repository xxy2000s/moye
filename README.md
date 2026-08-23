# Moye

Moye 是一个面向代码研发任务的全自动、可恢复、可追踪 Harness。它以 Task 为业务聚合根，协调 Agent、Daemon、Worktree、测试、Review、Git 合并和知识沉淀，目标是让一次研发任务从需求进入到主干合入形成可验证闭环。

当前状态：**Core v2 已用真实 Codex、Restate、隔离 Git 与受信任测试完成 Happy Path，并逐 Task 验收 Implementation Self Review Finding、Final Review Finding、Documentation Finding、真实 Test Failure Repair、Design Review Replan、Test `UNKNOWN → CONFIRMED | NOT_APPLIED`、Architect/Implementation/Final Review Worker 中断、Git Candidate Commit 回执未知和真实 Merge 回执未知；成功与失败 Task 都有独立 Closure Artifact 和可重试 Archive Receipt。历史 LIVE-001～004 已通过 append-only recovery successor 合法归档。Repair/Replan 预算耗尽、Observer/Knowledge 故障与 stale Attempt 尚未完成同等级真实 Agent 故障矩阵，不能视为 Core 完全闭环。**

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
```

Core v2 三个命令不会使用 Fake/Mock/Scenario Adapter：每个场景创建新的持久化运行目录和独立 Workflow key，调用真实 Codex、隔离 Git、Trusted Runner、双父 Merge、Closure 和 Archive，并从 Projection、Trace、Role Events、Manifest 与 Git DAG 生成 Evidence Summary。故障和恢复命令要求 Service 显式设置 `MOYE_ACCEPTANCE_FAULT_INJECTION=enabled`；普通 Service 会在 TaskAuthority claim 前拒绝 `acceptanceControl` 或 `recoveryControl`。这些命令消耗真实模型额度，不能用单元测试结果替代。

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

Coding Task 出现在看板后，点击卡片会路由到可直达和刷新的全屏 `/tasks/<task_id>` Task Audit Page；右上角“返回项目”回到 `/`，浏览器 Back/Forward 同样有效。默认视图以状态摘要和 Graph 画布为中心，不预占详情侧栏：

1. 当前业务状态、独立 Archive 状态，以及 Projection 与 Event History 是否一致；
2. 一张完整状态机 Graph 画布：normal、Repair、Replan、Reconcile、failure、archive 全部合法边常驻可查，实际 Event 走过的节点和边实时点亮；画布只在实际边显示清晰的 Event sequence 徽标，未发生边的完整说明按需查看，不再以小字铺满总览；可按本次路径、主流程、恢复/回滚、异常/失败和归档筛选；
3. 点击节点才打开详情：桌面在画布右侧显示 Inspector，窄屏在底部显示 Bottom Sheet；有真实 Session 的节点先展示 Agent 活动、分类计数、最近事件预览和“查看全部 Agent Events”主入口，再展示“状态流转记录”与系统控制事实。这里的 Domain Event 是 Workflow 写入、证明状态如何进入和离开的业务事实，不是 Agent 对话或工具日志；“合法转换”按进入/离开列出完整 `来源 → 目标`，并明确标记“本次经过 · #sequence”或“合法但未发生”。长 Run/Attempt/Evidence ID 默认收进技术详情。没有 Session 的节点只显示真实状态与系统事实，不补造 Agent；`Esc` 先关闭节点详情并把焦点还给节点，不会直接退出 Task；
4. 完整 Domain Event 使用纵向时间线逐条展示 sequence、`来源 → 目标`、event type、time 和原始 detail；没有状态转换的业务事实会明确标记，不伪造 `from/to`。“实际路径”、执行实例、完整合法边、角色会话和高级诊断默认折叠，需要时再展开；
5. 每条 Context、Implementation、Self Review、Review、Replan 与 Docs Gate Session 都在同一个 Chatbot 弹窗中展示；可按对话、工具调用、工具结果、系统和错误筛选，运行中增量跟随；Events 不跳转下载。

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

本轮已经实现 Task/Archive Workflow、Core v2 真实多角色 Happy Path、两阶段 Sealed Result Commit 自举协议、真实 Codex 与 Claude Print Adapter、Self Review、两次隔离 Review、Repair/Replan/Reconcile 领域协议、成功/失败 Closure 与独立 Archive Effect、真实本地双父 Merge/Reconcile、停滞 Workflow 的窄化 successor、全部 Session Event 下钻、实际路径点亮的只读状态机 Graph、确定性 Observer、Board Projection、三层 Trace、OTLP 和统一 CLI。当前真实产品证据还覆盖 Finding 驱动 Repair/Replan、Test `UNKNOWN → CONFIRMED | NOT_APPLIED`、Role Worker 中断、Git Candidate Checkpoint 回执丢失与 Merge 回执丢失；预算、旁路 Observer/Knowledge 故障和 stale Attempt 等异常分支仍按 [Core v2 Roadmap](./docs/delivery/core-v2-roadmap.md) 逐条补齐。多 Daemon/Lease/Fencing、远程 Git Provider/PR、鉴权、多租户，以及 Metrics/Logs/告警/SLO 等仍未完成。
