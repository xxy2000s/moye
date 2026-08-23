# TASK-0040R2 Design

将 recovery source ref 解析为带判别字段的 union：`SealedTaskRecoveryWorkflow/<task-id>` 或 `SealRecoveryAttemptWorkflow/<recovery-id>`。Workflow 按 service 读取对应 shared `status`，再由 `TaskAuthority.advanceSealedRecovery()` 原子校验该 source 仍是当前 chain head。

根 `SealedTaskWorkflow` 继续提供 immutable Intent、原 rejected Evidence 和 Gate 路径；每个 successor 只新增自己的 Projection 与 Event。新的 recoveryId 永不复用。Commit 仍需满足原 Intent 的 parent、package、verification、Docs Impact 和 HEAD ancestry门禁。
