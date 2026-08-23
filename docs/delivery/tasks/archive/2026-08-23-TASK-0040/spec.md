# TASK-0040 Spec：Core v2 失败终态闭环

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0042](../../../backlog/BL-0042.yaml)

- `REQ-0040-01`：任一不可恢复阶段错误或预算耗尽必须保留原始失败阶段、原因、Workflow、Attempt、Session 与 Event，并形成唯一 `FAILED_TERMINAL` Outcome；
- `REQ-0040-02`：失败路径必须依次形成 Failure Closure、Failure Artifact、`none | proposed | deferred | applied` Knowledge Disposition、Archive Pending 和 Archived/Failed；
- `REQ-0040-03`：失败 Archive 不得调用 Implementation、Test 或 Merge；Archive Failed 后只允许以相同 Effect Identity 重试 Archive；
- `REQ-0040-04`：LIVE-001～004 必须通过 `TaskAuthority` 授权的 append-only Core v2 recovery successor 收敛，禁止直接修改原 Workflow 或 ProjectBoard Projection；
- `REQ-0040-05`：Board/Trace 查询默认解析合法 successor，同时保留原 Workflow 引用和完整历史，并准确区分归档状态；
- `REQ-0040-06`：单元与真实 Restate E2E 证明幂等、冲突 successor 拒绝、原历史保留和四个历史任务最终归档。
