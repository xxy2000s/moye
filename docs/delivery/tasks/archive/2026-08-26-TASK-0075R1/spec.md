# TASK-0075R1 Spec

> 状态：Approved
> Backlog：[BL-0080](../../../backlog/BL-0080.yaml)
> Incident：[TASK-0075 Seal 非 canonical Runtime](../../../../sources/incidents/2026-08-26-ga-seal-submitted-to-stale-runtime.md)

## 目标

在不复制 Projection、不重复相同 Workflow key、不创建第二份实现结果的前提下，让包含 M1/M2 历史的 canonical Runtime 对同一 W10 Result Commit 形成可查询、可归档的 handoff Task。

## Requirements

- `REQ-0075R1-01`：使用独立 Workflow key `TASK-0075R1`，显式提交到 canonical `50889/50890` Runtime。
- `REQ-0075R1-02`：TASK-0075 与 TASK-0075R1 的 Seal Receipt 必须绑定同一 Base、Result Commit 和 Result Tree；不得各自产生实现 Commit。
- `REQ-0075R1-03`：两个 Task 都由 owning Workflow 达到 `CLOSED + ARCHIVED + SUCCEEDED`，错误入口的 Invocation/Projection 保留。
- `REQ-0075R1-04`：最终 Board 使用 canonical Runtime，并能查询 TASK-0075R1 及 M1/M2 历史。

## 非目标

- 不把两个 Restate cluster 合并，不复制 Journal/Projection，不把 TASK-0075R1 声称为 Restate 内建 recovery successor。
