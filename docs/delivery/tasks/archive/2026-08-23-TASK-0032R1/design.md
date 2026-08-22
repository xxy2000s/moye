# TASK-0032R1 Design

新增 `SealedTaskRecoveryWorkflow/<task_id>` 与显式 `SealRecoveryAttemptWorkflow/<recovery_id>`，从原 `SealedTaskWorkflow.sealStatus` 读取冻结 Intent、错误 Evidence，并从 Authority 当前 source ref 读取失败 predecessor。它不解析第二个 Promise，也不修改任何旧 Workflow；TaskAuthority 以 source/recovery refs 冻结 append-only chain。

Historical Gate 复用 Seal 内容校验，但用 `resultCommit is-ancestor HEAD` 替代 `HEAD == resultCommit`，并在目标 Commit 的 detached worktree 运行 Docs Impact。成功 Projection从 predecessor Event 序列追加 `SealRecoveryStarted → SealCommitVerified → TaskClosed → ArchiveArchived`。CLI 与 Board 解析 Authority 中的 service/key；原服务仍可按显式 URL 查询。
