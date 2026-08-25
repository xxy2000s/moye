# TASK-0058 Verification 状态导致 Seal 失败

> 文档类型：Incident
> 状态：Resolved
> 发生日期：2026-08-25

## 事实

- `TASK-0058` 的唯一 Result Commit 为 `b7d969a59c9706b716a8aee14c7b0262ef74141f`，parent 是冻结 Base `59642d73f9273e2944cd62f49042196bb4cd9191`；
- `npm run check`、`npm run test:e2e`、Docs Graph、Docs Impact 与独立 P0 审计均通过；
- Verification 机器状态被写成 `> 状态：Verified；Seal prepared`，不符合 Gate 只接受精确 `> 状态：Accepted` 的协议；
- owning `SealedTaskWorkflow/TASK-0058` 合法形成 `FAILED_TERMINAL + ArchiveFailed`，原 Intent、Evidence、Commit 和 Event 全部保留。

## 处置

不 amend rejected Commit、不重新提交相同 Workflow key、不修改 Projection。`TASK-0058R1` 增加 `seal-stage` 的 Accepted 状态预检，在移动 Active package 之前 fail closed；随后生成以原冻结 Base 为 parent 的 corrected sibling Commit，将其并入主线 ancestry，再通过 `SealedTaskRecoveryWorkflow/TASK-0058` 追加 successor 收敛原任务。

工作项：[BL-0070](../../delivery/backlog/BL-0070.yaml)。

## 结果

- `TASK-0058R1` 以 Result Commit `a92ce94859a346fbf686fe360c81e2ac11a02fa5` 完成防复发修复并归档；
- 原 `TASK-0058` 首次 corrected sibling 因 Verification 当前字节与历史 Gate 不一致被 successor 拒绝，失败 Event 保留；
- 第二个 corrected sibling `339ad003ce52c000ea848a0e13976302d297dc0a` 以原冻结 Base 为唯一 parent，并由 `SealRecoveryAttemptWorkflow/TASK-0058-RECOVERY-1` 合法验收；
- `TASK-0058` 最终唯一收敛为 `CLOSED + ARCHIVED + SUCCEEDED`，package digest 为 `sha256:c800713832403af0b3782aca358d06fa24d4ef4d474a91d9fb1b5d5a5a6f57a7`；原失败 Workflow、Attempt、Commit 和 Event 1～13 均未删除或覆盖。
