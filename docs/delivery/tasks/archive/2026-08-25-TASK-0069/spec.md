# TASK-0069 Spec

> 状态：Approved
> Milestone：M2-W04
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

交付 `pluginApiVersion: 1` 的公共 Plugin SDK，为 Agent Runner、Workspace/Git、Trusted Test、Documentation、SCM、Artifact Store 与 Knowledge Sink 提供统一、可协商和可验证的 Adapter 契约，同时保持 Workflow 对 Task 主状态的唯一所有权。

## Requirements

- `REQ-0069-01`：七类 Adapter 使用稳定 descriptor、capability、operation context 和 `COMPLETE | UNKNOWN | FAILED` Result，公共上下文不包含 Projection 或状态迁移入口。
- `REQ-0069-02`：能力协商必须显式验证 plugin API 版本、Adapter kind、required/optional capability；不支持项返回稳定拒绝原因，不静默降级。
- `REQ-0069-03`：声明外部副作用或可能返回 UNKNOWN 的 Adapter 必须声明并实现 Reconcile；相同 operation/idempotency key 的结果与对账必须幂等，冲突 Evidence 被拒绝。
- `REQ-0069-04`：提供可供第三方复用的 contract suite；Moye 内建七类 Adapter descriptor/bridge 全部通过同一套契约。
- `REQ-0069-05`：Plugin 不得声明 Task 状态、Projection、Authority、Workflow dispatch 或 Runtime journal 写能力；契约校验 fail closed。
- `REQ-0069-06`：Plugin SDK v1 与 ADR-0008、Architecture、CodeMap 和后续 Documentation Policy/Package 工作包保持一致。

## 非目标

- 不在本 Task 实现 Plugin 市场、动态远程代码加载或多租户权限系统。
- 不把第三方 Plugin 直接接入 owning Workflow；W05～W09 在真实外部项目路径中逐项接线和验收。
- 不改变现有 Core v2 状态机或已归档 Evidence。
