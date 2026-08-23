# TASK-0040 Docs Impact 漏项导致 Seal 失败

> 文档类型：Incident
> 状态：Recovery Prepared；最终状态以 Runtime successor 为准
> 发生日期：2026-08-23
> 影响范围：TASK-0040、Sealed Result Commit、Docs Impact Gate

## 时间线

- `06:18:23Z`：`SealedTaskWorkflow/TASK-0040` 接收 Result Commit `9c68901e89e3fe378dbc5c84396eee2d005b19fe`；
- Gate 发现实际 changed path `docs/delivery/tasks/archive/README.md` 未在报告中登记；
- 原 Workflow 正确形成 `FAILED_TERMINAL + ArchiveFailed`，错误 Evidence 与 Event 被保留；
- 创建 BL-0044 / TASK-0040R1，通过新 Result Commit 补齐报告，并使用 `SealedTaskRecoveryWorkflow/TASK-0040` 重验同一 Intent；
- corrected Result Commit 生成后，通过 Runtime CLI 提交 recovery；Authority 只在 successor 成功后切换，原失败 Workflow 始终保持可查询。

## 根因与处置

TASK-0040 在 `seal-stage` 前完成 Docs Impact 清单；stage 后新增 Archived Tasks 索引变更，但最终提交前没有再次把完整 changed paths 与报告逐项对齐。

不 amend、不删除失败 Workflow、不改 Runtime Projection。恢复提交只追加缺失 changed path 和独立 TASK-0040R1 证据；旧 Commit 继续保存原漏项。后续 Seal 前必须在 stage 完成后执行最终 changed-path 对账。

工作项：[BL-0044](../../delivery/backlog/BL-0044.yaml)。
