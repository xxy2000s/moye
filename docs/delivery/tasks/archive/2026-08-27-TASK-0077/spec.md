# TASK-0077 Spec

> 状态：Approved
> Milestone：[M3 Backlog 与 Session Clarity](../../../milestones/m3-backlog-and-session-clarity.md)

## 目标

建立向后兼容的 Backlog v2 问题描述合同，使 Runtime Projection 持久保存页面所需的问题、影响范围与验收方向，同时保持 v1 文档只读兼容和正式同步的批次幂等、所有权及摘要门禁。

## Requirements

- `REQ-0077-01`：v2 文档必须包含非空 `problem.observed`、`problem.expected`、`problem.impact`，`problem.evidence_refs` 允许为空但必须是稳定非空字符串列表。
- `REQ-0077-02`：v1 文档继续可解析和同步，不批量迁移历史文档；v1 Projection 明确保留 `schemaVersion: 1` 且不补造 problem。
- `REQ-0077-03`：Projection 持久保存 `schemaVersion`、`problem`、`affectedAreas` 与 `acceptanceOutline`，Document Digest 覆盖原始 v2 文档。
- `REQ-0077-04`：Parser 对版本、未知字段、缺失/空问题字段、非法引用和枚举 fail closed；Runtime 新建 v2 Backlog 不能绕过同等合同。
- `REQ-0077-05`：相同文档同步保持幂等；伪造 batch digest、重复 ID 与文档/Runtime 所有权冲突继续拒绝。
- `REQ-0077-06`：完成定向单元与真实 Restate E2E、仓库 check、Docs Impact、唯一 Result Commit、Seal 和 Archive。

## 非目标

- 不升级任何现有 Backlog 内容；该工作属于 TASK-0078。
- 不修改 Backlog 页面；该工作属于 TASK-0079。
- 不直接写 ProjectBoard Projection，也不执行 BL-0083 正式同步。
