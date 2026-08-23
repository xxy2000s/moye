# Core v2 Design Reviewer 把未来阶段尚未发生误判为 Finding

> 文档类型：Finding
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23
> Runtime Task：`TASK-ACCEPT-20260823102846-02-FINAL-REVIEW`

真实 Final Review Finding 验收 Task 的 Revision 1 Design Reviewer 在 Implementation 尚未开始时检查工作树，因 `src/value.txt`、`SECURITY.md`、Trusted Test Evidence 尚不存在而返回 Blocking Findings，Workflow 合法进入 REPLAN。该结果来自真实 Codex Session，不是 Adapter，也没有被覆盖或删除。

根因是通用 Review Prompt 没有充分声明 Design Review 的阶段边界。Design Review 应只审查当前 Spec、Design、Plan 的完整性和可实现性，不能把 Candidate、测试、Merge、Closure 或 Archive 尚未发生当成设计缺陷。TASK-0043 将两个 Review Phase 的边界分开：Design Review 明确限定在前置设计 Artifact；Final Review 才检查 Candidate、Documentation 和 Trusted Test Evidence。原 Task 作为真实验收失败历史保留，修复后使用新 Workflow key 重跑。

修复后 Implementation、Final Review、Documentation、Test Failure 四个独立真实 Task 的初始 Design Review 均通过；`TASK-ACCEPT-20260823111330-02-DESIGN-REPLAN` 只因验收指定的真实设计缺陷进入 Replan，并在 Revision 2 通过。
