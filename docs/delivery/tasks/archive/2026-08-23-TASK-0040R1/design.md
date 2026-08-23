# TASK-0040R1 Design

不修改 Runtime 状态，也不 amend `9c68901`。当前 HEAD 追加一个提交：修正 TASK-0040 Docs Impact，并加入 Incident、Backlog、TASK-0040R1 package 与文档图关系。

提交后调用 `SealedTaskRecoveryWorkflow/TASK-0040`，在 corrected Commit 的 detached worktree 重验同一 Intent。TASK-0040R1 使用自己的 `SealedTaskWorkflow` 与 Result Commit，不与被恢复 Task 共用 Evidence。
