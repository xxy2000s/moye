# Moye

Moye 是一个面向代码研发任务的全自动、可恢复、可追踪 Harness。它以 Task 为业务聚合根，协调 Agent、Daemon、Worktree、测试、Review、Git 合并和知识沉淀，目标是让一次研发任务从需求进入到主干合入形成可验证闭环。

当前状态：**首个本地单 Agent 编码闭环、真实 Codex/Claude CLI 事件流、三层 Trace 与可选 OTLP/Phoenix 诊断 Demo 已实现并通过验收**。

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

命令会自动分配空闲端口、启动 Restate，并在隔离 Git Fixture 中用确定性 Fake Agent 完成一次 Coding Task：创建 Worktree、修改文件、提交、验证、合入和归档。它不会修改 Moye 仓库。打开终端中 `项目看板:` 后面的 URL，点击“已归档”列中的 Task，就能看到中文七阶段旅程；按 `Ctrl-C` 停止，演示数据保留在 `.moye-runtime/demo`。

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

运行时包含两个本地入口：

- Restate Service Endpoint：默认 `9080`；
- Moye Project Board：默认 [http://localhost:3000](http://localhost:3000)。

CLI 统一使用 `npm run cli -- <command>`；项目 Agent 应使用 [moye-task-control Skill](./.agents/skills/moye-task-control/SKILL.md) 路由文档依赖和关闭门禁。

Coding Task 出现在看板后，点击卡片默认先看到：

1. 任务结论与 Task → Workflow → Agent Session → Git Commit 关联链；
2. 需求与上下文、隔离工作区、Agent 编码、自动验证、合入分支、文档检查、归档七个阶段；
3. 每个阶段展开后的 Attempt 和 Evidence；
4. `查看 Agent Events` 在同一详情页内持续展示完整 Agent CLI JSONL，可筛选工具过程、展开原始 JSON，并通过游标读取全部事件。

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

本轮已经实现 Task/Archive Workflow、单 Agent 本地编码 Workflow、Fake/真实 Codex 与 Claude Print Adapter、增量 Agent JSONL、cursor 查询与交互看板、幂等 Worktree/Verification/Merge、Board Projection、三层 Trace 查询、标准 OTLP 输出、可选 Phoenix、受控 Artifact 下载、CLI、项目 Skill 和故障注入测试。多 Daemon 调度、GitHub PR/Merge、鉴权、完整 Repair/Replan，以及 Metrics/Logs/告警/SLO 等生产可观测性仍属于后续阶段。
