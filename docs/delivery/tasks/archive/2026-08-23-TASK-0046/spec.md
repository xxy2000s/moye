# TASK-0046 Spec：Core v2 Board 运行语义与验收历史 UX 修复

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)、[BL-0050](../../../backlog/BL-0050.yaml)

- `REQ-0046-01`：Board 只读视图必须区分 `SUCCEEDED`、`FAILED_TERMINAL`、执行中、`WAITING_RECONCILE`、`ARCHIVE_PENDING` 与 `ARCHIVE_FAILED`，不得由 UI 推进或覆盖 Projection；
- `REQ-0046-02`：Board API 为 Task 提供可审计的 Workflow kind 与运行态视图；当前 Core v2 发布显式事实，遗留记录通过 TaskAuthority 与保守兼容规则派生；
- `REQ-0046-03`：项目总览支持按 outcome、workflow kind、是否验收历史筛选，保留四列业务分组，并提供最新成功归档 Task 的直达入口；
- `REQ-0046-04`：验收历史必须有明显标识；筛选仅改变本地展示，不改变 Runtime 数据；
- `REQ-0046-05`：成功 Task 的 Failure/Repair/Replan/Reconcile 节点显示“合法但本次未发生”；只有 Event History 实际经过的异常节点与边显示为本次发生；
- `REQ-0046-06`：失败详情继续显示原始阶段、原因、Attempt、Session、Recovery 与 Archive 状态；Agent Events 继续在 Chatbot 弹窗中按类型筛选，不使用下载跳转；
- `REQ-0046-07`：补充领域/API/前端单元测试和真实浏览器桌面、移动验收；通过 `npm run check`、`npm run test:e2e`、Docs Impact 与唯一 Result Commit Seal。

本 Task 不补写、不扫描或迁移 Runtime Projection；所有 Board 信息必须能回指 TaskAuthority、Workflow Projection、Domain Event 或明确的遗留展示约定。
