# TASK-0081 Spec

> 状态：Approved
> Backlog：[BL-0083](../../../backlog/BL-0083.yaml)
> Milestone：[M3 W05](../../../milestones/m3-backlog-and-session-clarity.md)
> 依赖：[TASK-0080](../2026-08-27-TASK-0080/spec.md)

## 目标

让 Session Dialog、Board API error envelope 与诊断层统一消费 `SessionEvidenceSemanticsV1`，准确区分 Evidence 可读性、内容缺口、Prompt/Attempt 绑定可信度和 policy/provider 限制；保留原始 `PARTIAL/UNVERIFIED` 与 Artifact Digest 供高级诊断。

## Requirements

- `REQ-0081-01`：Session Dialog 主层展示 Availability、Content、Binding 与 Limitation 四个状态；禁止从 raw `captureState` 或 `promptBinding` 另行推断主提示。
- `REQ-0081-02`：历史 `AVAILABLE + COMPLETE + UNVERIFIED` 明确显示“会话内容可读；Prompt 与 Attempt 的强绑定无法追溯验证”，不得出现通用“记录不完整”。
- `REQ-0081-03`：Content `PARTIAL` 按 Domain reasons 显示消息、工具、时间、层级、raw、parse、unknown、drop、terminal 或 Capture Error 的具体缺口；不补造缺失内容。
- `REQ-0081-04`：`OMITTED_BY_POLICY / REDACTED / NOT_EXPOSED` 单独说明为策略或 Provider 能力边界，不计作数据丢失。
- `REQ-0081-05`：`PENDING / WAITING_RECONCILE / UNAVAILABLE / FAILED` 各有独立提示与安全建议；Artifact integrity error envelope 返回统一 semantics，并提示核对受管 Artifact/Digest、不要重跑 Agent。
- `REQ-0081-06`：高级诊断保留 raw Receipt state、promptBinding、completeness、metrics、errors、Manifest/Receipt/Artifact Digest；Execution Stream 保持独立降级入口。
- `REQ-0081-07`：真实 canonical 历史 Session、真实 partial managed Evidence、1440px/390px 浏览器、筛选、展开、Escape 与焦点返回通过；页面不写 Runtime 或 Evidence。

## 非目标

- 不修改 Transcript/Receipt/Manifest schema 或历史 Digest；
- 不修复 Provider source 本身，也不因 Capture 故障重跑 Agent；
- 不改变 Task Workflow、Projection 或 Session Timeline canonical events。
