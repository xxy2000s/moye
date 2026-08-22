# TASK-0032 Spec：Unified Real Role Runtime v2

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0034](../../../backlog/BL-0034.yaml)

## 目标

为 ARCHITECT、IMPLEMENTATION、DOCUMENTATION、TEST_VERIFICATION、REVIEW 提供同一个真实 Role Runtime 合约；旁路 OBSERVER_KNOWLEDGE 复用同一只读边界。所有实际执行都可按 Attempt、Generation、Session、Event、Artifact 和 Reconcile 审计与接管。

## 需求

- `REQ-0032-01`：统一 Role/Phase、权限和 Runner schema；产品协议只允许 `CODEX_EXEC | CLAUDE_PRINT`，没有 `FAKE` 枚举；
- `REQ-0032-02`：Attempt 状态单向、Generation 连续、旧 Attempt 终态不可复活，所有状态有内容摘要与事件；
- `REQ-0032-03`：Run Intent 绑定 Task/Revision/Attempt/Role/Phase/Runner/Scope/Input Artifact/Subject Commit；
- `REQ-0032-04`：真实进程的 Session、原始 Event、stderr、结构化 Output 和 Manifest 均持久化并校验摘要；
- `REQ-0032-05`：完整 Manifest 直接恢复复用；只有 Intent 时返回 UNKNOWN + Reconcile token，禁止自动执行第二次；
- `REQ-0032-06`：Reconcile 只接受 CONFIRMED 或带外部证据的 NOT_APPLIED；后者要求新 Generation Attempt，不复活旧 Run；
- `REQ-0032-07`：真实子进程 E2E 覆盖五类角色、重放、Intent-only、Reconcile 和篡改拒绝。

## 非目标

- 本 Task 不把角色接入主 Workflow 阶段；
- 不在自动回归中消耗真实模型额度；最终产品真实 Agent 验收由 TASK-0039 完成。
