# TASK-0058 Spec：定义完整 Agent Session 与 Prompt 证据协议

> 状态：Accepted
> Spec Revision：1
> Milestone：M1-W01

- `REQ-0058-01`：登记“Core v2 Role Session 只保存 CLI stdout、缺少完整 Prompt 与 Provider 原生时间线”的真实 Finding 和实施 Backlog；
- `REQ-0058-02`：定义内容寻址的 `PromptEnvelopeV1`，分别绑定 Task Input、System Control、Role Instructions 与 Rendered Prompt，并支持 `digest_only | redacted | full`；
- `REQ-0058-03`：定义 `ActiveRoleRunLocatorV1`，让后续 Runtime 能在 Agent 启动前发布 Attempt、Run、Prompt 与预期执行证据位置；
- `REQ-0058-04`：定义统一 `NormalizedTimelineEventV1`，准确区分 Prompt、Assistant、Tool Call、Tool Result、System、Error、stderr 和未知 Provider 记录；
- `REQ-0058-05`：定义 Transcript Manifest、终态 Disposition 与 Import Receipt，精确绑定 Task、Workflow、Role、Attempt、Revision、Generation、Run、Session、Provider、Artifact 和 Digest；
- `REQ-0058-06`：冻结 append-only enrichment、stale fencing、Capture UNKNOWN/Reconcile 与诊断补充权限边界，禁止 Transcript 推进 Task、改变 Gate 或令旧 Evidence 复活；
- `REQ-0058-07`：旧 `RoleRunEvidenceV2` 和封存 Role Manifest 必须保持可读且不被改写；历史 Prompt 只能声明经验证的 legacy binding 或 `UNVERIFIED`，不能补造当时不存在的 Prompt Envelope；
- `REQ-0058-08`：字段校验、canonical digest、隐私策略、跨对象绑定和篡改拒绝必须由自动化测试证明，并完成 Architecture、ADR、CodeMap 与 Docs Impact 门禁。
