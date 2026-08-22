# Moye

Moye 是一个面向代码研发任务的全自动、可恢复、可追踪 Harness。它以 Task 为业务聚合根，协调 Agent、Daemon、Worktree、测试、Review、Git 合并和知识沉淀，目标是让一次研发任务从需求进入到主干合入形成可验证闭环。

当前状态：**真实 Coding Task 已能从统一 CLI 发起，并在 Board 全程审计 Context、Implementation、Self Review、Verification、独立 Review、Repair/Replan、Merge、Docs Gate、Closure 与成功/失败 Archive；完整多 Session 闭环已通过真实 Codex 验收**。

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

该命令通过可选 Compose Profile 启动本地 Phoenix，再运行同一个隔离 Demo。Moye Board 会展示稳定 Trace ID、Phoenix 入口和 Agent Events；点击 `查看 Agent Events` 后可按对话、工具调用、工具结果、系统和错误筛选，运行中自动刷新，完成后可通过 cursor 页面访问全部事件或下载经过摘要校验的原始 JSONL。Phoenix 只负责技术诊断，默认 `npm run demo` 不启动它；停止 Trace 后端使用 `npm run trace:down`。

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

真实、隔离、可重复的产品验收命令是：

```bash
npm run acceptance:live
```

运行时包含两个本地入口：

- Restate Service Endpoint：默认 `9080`；
- Moye Project Board：默认 [http://localhost:3000](http://localhost:3000)。

CLI 统一使用 `npm run cli -- <command>`；项目 Agent 应使用 [moye-task-control Skill](./.agents/skills/moye-task-control/SKILL.md) 路由文档依赖和关闭门禁。

Coding Task 出现在看板后，点击卡片会进入居中的 Task Audit Workspace。默认视图以状态摘要和 Graph 画布为中心，不预占详情侧栏：

1. 当前业务状态、独立 Archive 状态，以及 Projection 与 Event History 是否一致；
2. 一张完整状态机 Graph 画布：normal、Repair、Replan、Reconcile、failure、archive 全部合法边常驻可查，实际 Event 走过的节点和边实时点亮；可按本次路径、主流程、恢复/回滚、异常/失败和归档筛选；
3. 点击节点才打开详情：桌面在画布右侧显示 Inspector，窄屏在底部显示 Bottom Sheet；有真实 Session 的节点先展示 Agent 活动、分类计数、最近事件预览和“查看全部 Agent Events”主入口，再展示“状态流转记录”与系统控制事实。这里的 Domain Event 是 Workflow 写入、证明状态如何进入和离开的业务事实，不是 Agent 对话或工具日志；长 Run/Attempt/Evidence ID 默认收进技术详情。没有 Session 的节点只显示真实状态与系统事实，不补造 Agent；`Esc` 先关闭节点详情并把焦点还给节点，不会直接退出 Task；
4. “实际路径”、执行实例、完整合法边、角色会话和高级诊断默认折叠，需要时再展开；每条实际转换仍绑定 Event sequence/type/time；
5. 每条 Context、Implementation、Self Review、Review、Replan 与 Docs Gate Session 都在同一个 Chatbot 弹窗中展示；可按对话、工具调用、工具结果、系统和错误筛选，运行中增量跟随，原始 JSON/JSONL 只作为下钻与导出证据。

Restate Journal、恢复建议、技术 Artifact 与原始事件收在“高级诊断”中。进入 Restate 的链接已经按 `CodingTaskWorkflow + task_id` 过滤；Restate 负责执行排障，Moye Board 才是任务业务视图。

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

本轮已经实现 Task/Archive Workflow、真实多角色本地 Coding Workflow、Fake/真实 Codex 与 Claude Print Adapter、Self Review、独立 Review、Repair、Spec Revision N+1 Replan、显式 WAITING_RECONCILE/Resume、成功与失败归档、全部 Session JSONL 下钻、实际路径点亮的完整只读状态机 Graph、幂等 Worktree/Verification/Merge、Board Projection、三层 Trace、OTLP、受控 Artifact 下载和统一 CLI。多 Daemon/Lease/Fencing、远程 Git Provider/PR、鉴权、多租户，以及 Metrics/Logs/告警/SLO 等生产运营能力仍属于后续阶段。
