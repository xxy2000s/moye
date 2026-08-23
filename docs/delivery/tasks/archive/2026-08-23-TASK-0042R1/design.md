# TASK-0042R1 Design

不修改 Runtime Projection，也不 amend rejected Commit。TASK-0042R1 在当前主线以 `a0501f7…` 为 Base 创建独立 Result Commit，登记 Incident、Backlog、Recovery Task 和防复发 Pitfall。

原 TASK-0042 的 corrected Evidence 另建为冻结 Base `34c07dc…` 的 sibling Commit：复用 rejected tree，只把 Verification 第一行规范为 `> 状态：Accepted`。先完成 TASK-0042R1 Seal，再把 sibling 通过显式 merge 纳入主线 ancestry；最后调用 `SealedTaskRecoveryWorkflow/TASK-0042` 在 corrected Commit 的 detached worktree 重验原 Intent。这样 rejected Commit、Recovery Task Result Commit、corrected Evidence 和 integration ancestry都可独立审计。
