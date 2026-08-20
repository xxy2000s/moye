# Demo 未展示编码任务与 Agent Trace

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-20  
> 影响范围：Demo、ProjectBoard、Coding Trace、用户理解

## 观察

执行 `npm run demo` 后，演示任务只经过通用 `TaskWorkflow` 的创建、执行、验证、关闭和归档。它没有进入 `CodingTaskWorkflow`，因此不存在 Worktree、Pipeline Step/Attempt、Agent Session、Verification Evidence 或 Git Commit 链。

用户打开 Restate UI 时只能看到大量底层 Invocation，无法理解它们与一个研发 Task、Agent 执行和 Git 结果的关系。Moye Board 对该 Demo Task 请求 `/api/tasks/<task_id>/trace` 会返回 `409 Detailed coding trace is not available for this Task workflow`。

## 影响

- README 所述 Coding Trace 能力无法通过一键 Demo 直接体验；
- Restate Invocation 数量容易被误解为 Task 或 Agent 数量；
- 用户需要理解底层 Service/Handler，才能猜测业务任务进度；
- 已实现的 Task→Workflow→Attempt→Agent→Git 关联没有形成面向人的产品入口。

## 修复边界

Demo 应提交一个隔离 Fixture 上的 Fake `CodingTaskWorkflow`；Moye 任务详情应以中文 Pipeline 为默认视图，关联 Task、Attempt、Agent Session、Commit 和验证结果。Restate UI 只作为折叠的高级排障入口，并链接到对应 Workflow 查询，而不是要求用户从 Overview 自行搜索。

后续工作进入 [BL-0009](../../delivery/backlog/BL-0009.yaml)。
