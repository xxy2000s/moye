# TASK-0007 Spec：基础 Trace、恢复视图与完整闭环故障验收

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0002

## 目标

为 Coding Task 提供一个由只读 Projection 派生的统一 Trace：输入 `task_id`，即可找到 Step、Attempt、Agent Session、Branch、Commit、验证证据与建议恢复动作。看板明确分开业务事实、Restate Journal 和技术日志，且用真实中断测试证明闭环可以交接。

## Requirements

### REQ-0007-01：统一 Trace 查询

- 提供稳定的只读 API，通过 `task_id` 返回 Coding Projection 的 Step、Attempt 和事件时间线；
- 关联 Agent Run/Session、Workspace Branch、Checkpoint/Result/Merge Commit、Verification Binding 和 Artifact；
- TaskAuthority 用于解析同一 Task 的唯一主 Workflow，Board 不扫描目录推断状态。

### REQ-0007-02：三层事实边界

- 业务 Event 与 Projection 是任务状态事实；
- Restate Journal 只描述 durable execution/replay，页面提供 Workflow 标识和管理员定位信息；
- stdout/stderr/JSONL 等是技术日志或 Artifact，只作为诊断证据，不替代业务终态。

### REQ-0007-03：恢复视图

- 根据当前 Projection 派生 `NONE`、`WAIT_OR_RECONCILE`、`FAILED_TERMINAL`、`ARCHIVE_RETRY` 等恢复分类和动作建议；
- 恢复视图只读，不在 Board 内实现第二套状态机；
- 已知结果优先展示 Reconcile/复用路径，禁止建议盲目重复外部副作用。

### REQ-0007-04：闭环故障验收

- 覆盖 Agent 异常退出、Service 重启、Git 已完成但 Step 未确认、重复命令和验证失败；
- 每类测试证明唯一终态、昂贵操作不重复或明确停止、Branch/Commit/证据可追踪；
- 完成后清理临时 Fixture、Worktree、子进程和测试容器。

### REQ-0007-05：操作与架构文档

- README 给出启动、Trace API 与看板使用入口；
- Runbook 说明三层事实的排障顺序和中断恢复判断；
- Architecture 与 CodeMap 固化 Trace 的只读边界、模块位置和证据链。

## 非目标

- 不实现完整 Repair/Replan、BudgetLedger、Lease/Fencing 或多 Daemon；
- 不实现远程 Git、PR 或生产级 Telemetry/告警；
- 不从页面直接修改 Workflow 状态，也不把 Restate Journal 复制成第二份业务数据库。

## 完成定义

单元测试和真实 Restate E2E 覆盖 Trace 映射与五类故障；看板可从 task_id 展示三层事实及恢复动作；全量检查、文档影响门禁和独立复审通过，并完成 Runtime Closure、Archive 与本轮运行资源清理。
