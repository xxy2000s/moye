# TASK-0030 Spec：Core v2 架构与单提交 Seal 协议

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0032](../../../backlog/BL-0032.yaml)

## 目标

把 5 个主流程 Agent + 1 个非阻塞 Observer/Knowledge 从需求输入提升为正式 Architecture/ADR，并实现两阶段 Seal，使一个 Task 的代码、文档、最终 Task Package 和 Archive 位置进入同一个 Result Commit，Workflow 验证后不再修改 Git 工作树。

## 需求

- `REQ-0030-01`：Architecture 固定 ARCHITECT、IMPLEMENTATION、DOCUMENTATION、TEST_VERIFICATION、REVIEW 和旁路 OBSERVER_KNOWLEDGE 的权限、Attempt、Artifact、Gate 与返工关系；
- `REQ-0030-02`：ADR 固定 5+1 模型，Verification Gate/Trusted Runner/确定性 Observer 明确不是 Agent；
- `REQ-0030-03`：ADR 固定 `PREPARING_SEAL → WAITING_COMMIT → VERIFYING_SEAL → CLOSED/ARCHIVED` 两阶段提交协议，目录位置本身不代表 Runtime 状态；
- `REQ-0030-04`：Workflow 在提交前生成稳定 Seal Intent 并等待 Evidence；Agent 把最终包放入 Archive 后创建唯一 Result Commit，再通过受限 handler 提交 Commit Evidence；
- `REQ-0030-05`：Gate 验证 Result Commit 当前 HEAD、父提交、Archive package、Task/Revision、Seal Intent、Verification/Docs Impact 与 changed paths；成功后只更新 Runtime Projection，不写工作树；
- `REQ-0030-06`：真实 Git + Restate E2E 覆盖等待、错误 Commit、重复 seal、Worker 重启和最终 clean worktree。

## 非目标

- 在本 Task 接入五类真实 Agent；
- 多 Daemon、远程 Git、PR 或发布；
- 允许目录扫描代替 Runtime Projection。
