# Sealed Recovery Attempt 无法从已失败 Attempt 继续追加

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-23

## 真实现象

`TASK-0040` 的第一层 `SealedTaskRecoveryWorkflow` 因 corrected commit parent 不匹配失败；随后 `SealRecoveryAttemptWorkflow/TASK-0040-RECOVERY-1` 因 corrected commit 尚未成为 HEAD 祖先失败。Authority 已合法前移到 numbered Attempt，但当前实现的 `parseRecoveryWorkflowRef()` 只接受 `SealedTaskRecoveryWorkflow/<task>`，无法读取 `SealRecoveryAttemptWorkflow/<recovery-id>` 作为下一条 append-only successor 的 source。

## 影响

Recovery Attempt 再次失败后，任务会合法停在 `FAILED_TERMINAL + ArchiveFailed`，但不能继续通过正式状态机恢复；直接重交同一 Workflow key 会与已持久化 Input 冲突，清理 Runtime 或写 Projection 都不合法。

## 预期

numbered recovery 必须能够从第一层 recovery 或前一个 numbered Attempt 读取失败 Projection；TaskAuthority 必须校验 source 是当前 chain head；每个新 Attempt 使用新的 recoveryId，保留所有 predecessor Event 和 Evidence。
