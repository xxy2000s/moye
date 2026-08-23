# TASK-0049R1 Spec：修正 Seal 启动预检与 Core v2 Runtime 终态台账

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0059](../../../backlog/BL-0059.yaml)、[BL-0060](../../../backlog/BL-0060.yaml)

- `REQ-0049R1-01`：`seal-start` 必须在提交 Restate Invocation 前，以与 owning Workflow 相同的规则验证 HEAD/Base、Active Task package、Manifest identity 与 Archive path；无效输入不得创建 Runtime Task Projection、Authority 或 Board row；
- `REQ-0049R1-02`：Workflow 内部和最终 Result Commit Gate 的既有兜底校验必须保留，CLI Preflight 不取得状态推进权；
- `REQ-0049R1-03`：保留 `SealedTaskWorkflow/TASK-0049` 的 completed Failure Invocation，不复用 key、不 purge、不伪造 Projection，并以 Incident 解释它为什么不是一个业务 Task 终态；
- `REQ-0049R1-04`：Roadmap 与 Archived Task 索引必须以只读 Runtime 查询为证据，修正 TASK-0030～TASK-0048 的终态，并记录实际 Result Commit 与 Package Digest；
- `REQ-0049R1-05`：不得修改任何既有 Archived Task package、Runtime Projection、Workflow Event 或 Receipt；
- `REQ-0049R1-06`：记录 2026-08-24 对 16 场景矩阵的重新审计、自动门禁和浏览器/API 回归，同时继续明确生产能力边界；
- `REQ-0049R1-07`：本修复必须形成唯一 Result Commit，并由新的 `SealedTaskWorkflow/TASK-0049R1` 完成 Seal 与 Archive。
