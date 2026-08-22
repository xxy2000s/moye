# TASK-0020 Spec：在页面展示真实 Task 状态机与转换证据

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0021

## 目标

让用户从 Board 直接审计一个 `task_id` 的业务状态机，而不是相信静态阶段条或最终结果。视图必须明确区分“允许的转换”和“这次任务实际发生的转换”，并能下钻到 Event、Attempt、Agent/Review Run、Verification、Git 与 Archive 证据。

## Requirements

### REQ-0020-01：状态机是 Runtime 事实的只读投影

- Trace API 返回有版本的状态机定义、当前状态、合法边和实际转换历史；
- 每条实际转换绑定原始 Event sequence/type/time，不由浏览器猜测；
- 页面标明业务 Projection 是状态权威、Restate Journal 是执行恢复权威，Trace 不可写。

### REQ-0020-02：完整展示当前已实现的 Coding 状态机

- 展示 `CONTEXT → WORKSPACE → IMPLEMENT → VERIFY → REVIEW → MERGE → DOCS → CLOSED`；
- 展示 `REVIEW → IMPLEMENT` Repair 回边、任意活动节点到 `FAILED` 的终止边；
- Archive 作为正交状态展示 `NOT_READY → PENDING/ARCHIVING → ARCHIVED | FAILED`，不能伪装成 Task 主状态；
- 页面区分未进入、已经过、当前和终态节点。

### REQ-0020-03：Attempt 与执行顺序真实

- 每次 Implementation/Repair Agent Run 创建独立、连续 Generation 的 `StepAttempt`；
- Verification、Review、Repair 的 Event 必须在实际执行边界写入，不得完成后倒序补事件；
- 状态机视图能列出 Attempt ID、Generation、Run/Session、结果和 Evidence Digest。

### REQ-0020-04：通用 Task 可审计

- 通用 Task 详情从 `TaskCreated/TaskExecuting/TaskVerifying/TaskClosed/Archive*` Event 展示实际状态转换；
- Bootstrap Evidence 作为转换证据展示，不再只给一段“没有 Coding Trace”的说明。

### REQ-0020-05：真实验收

- 使用真实 Codex 执行一个 Coding Task；
- Board 中能看到实际完整成功路径、Implementation 与独立 Review Session、验证、Merge 和 Archive；
- 自动化验证正常路径、Repair 回边、失败边和 Archive 失败分支；
- `npm run check`、真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

### REQ-0020-06：真实 Agent 能在普通仓库提交

- Codex `workspace-write` 沙箱显式允许写入 Request 已解析并验证的 Git common dir；
- 不扩大到仓库根之外的任意路径，不使用 `danger-full-access`；
- 单元测试固定 argv 边界，真实普通仓库 Task 能创建 Result Commit。

## 非目标

- 不实现 Architecture 中尚未落地的 Lease/Fencing、多 Daemon 或完整 Replan 状态；
- 不让 UI、Trace Builder 或 CLI 推进 Task 状态；
- 不把 Restate execution status 等同于 Task business state；
- 不要求通过 Web 创建任务，任务入口可以继续使用 CLI/API。

## 完成定义

用户点击一个真实 Task 后，可以逐条核对状态机合法边、实际 Event 转换、Attempt/Agent/Review、门禁证据、Git 结果和独立 Archive 终态；页面中不存在无法追溯到 Projection 的“完成”节点。
