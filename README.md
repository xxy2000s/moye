# Moye

Moye 是一个面向代码研发任务的全自动、可恢复、可追踪 Harness。它以 Task 为业务聚合根，协调 Agent、Daemon、Worktree、测试、Review、Git 合并和知识沉淀，目标是让一次研发任务从需求进入到主干合入形成可验证闭环。

当前状态：**Restate PoC 已实现并通过验收**。

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

命令会自动分配空闲端口、启动 Restate、注册 Moye、创建一个演示 Task，并在闭环完成后打印实际看板地址。打开终端中 `项目看板:` 后面的 URL，点击 `Archived` 列中的 Task，就能看到状态、Attempt、归档结果和完整事件轨迹。按 `Ctrl-C` 停止；演示数据保留在 `.moye-runtime/demo`。

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

本轮已经实现 Task/Archive Workflow、幂等文件归档、Board Projection、查询 API、静态看板、CLI、项目 Skill 和故障注入测试。真实编码 Agent、多 Daemon 调度、GitHub PR/Merge、鉴权与生产可观测性仍属于后续阶段。
