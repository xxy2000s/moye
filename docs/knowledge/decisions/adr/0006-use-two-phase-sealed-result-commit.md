# ADR-0006：使用两阶段 Sealed Result Commit 关闭仓库 Task

> 状态：Accepted
> 日期：2026-08-23
> 决策者：Moye Core
> 关联文档：[Core v2 Agent Lifecycle](../../current/architecture/core-v2-agent-lifecycle.md)

## Context

旧 Bootstrap 协议先创建 Result Commit，再由 Runtime 改写 `task.yaml` 并移动到 Archive。若把这些变化再提交，Evidence 中的 Result SHA 立刻过期；若不提交，工作树不干净且 Task 历史不能持久保存。因此“一个 Task 一个 Result Commit”和“Runtime 关闭后写 Git Archive”形成不可解的 SHA 循环。

## Decision

采用两阶段 Seal：

1. Workflow 验证 Active Task 和 Base，生成稳定 Seal Intent，进入 `WAITING_COMMIT`；
2. 执行者把最终 Task package 写成 sealed 状态并放入 Archive 路径，创建包含代码、文档和该 package 的唯一 Result Commit；
3. 通过受限 handler 提交 Result Commit、Seal Intent 和 Evidence refs；
4. Workflow 验证 HEAD、父提交、Archive package、Task/Revision、Intent、Verification、Docs Impact 和 changed paths；
5. 成功后只发布 Runtime `CLOSED + ARCHIVED`，不再修改文件系统。

目录位置从此只是 Seal Evidence，不能单独证明 Runtime Task 已关闭。Result Commit SHA 只保存在 Runtime/外部 Evidence，不写入同一 Commit 的内容，从而消除自引用。

## Consequences

- 每个 Task 的全部仓库事实进入一个 Result Commit，关闭后 worktree 保持 clean；
- Workflow 会在 Commit 前短暂等待 durable signal，必须支持 Worker 重启和重复 seal；
- 提交者必须严格按 Seal Intent 准备 package，错误 Commit 被拒绝但不能盲目创建第二个 Commit；
- 旧 goal-bootstrap 只保留兼容读取/历史恢复，不用于 Core v2 后续 Task。

## Rejected

- Closure 后再建 Archive Commit：一个 Task 对应多个提交；
- amend Result Commit：已接受 Evidence SHA 失效；
- 把 Runtime Artifact 移出 Git：用户要求项目历史随仓库持久保存；
- 从 Archive 目录反推关闭状态：形成第二套隐式状态机。
