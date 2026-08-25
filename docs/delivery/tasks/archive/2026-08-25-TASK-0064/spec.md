# TASK-0064 Spec：Append-only Historical Session Enrichment

> 状态：Approved
> Spec Revision：1

- `REQ-0064-01`：新增独立 `TranscriptEnrichmentWorkflow` 与 Session Evidence Registry；它们只能追加 `DIAGNOSTIC_SUPPLEMENT_ONLY` Sidecar，不能认领或推进 Task 主状态；
- `REQ-0064-02`：Workflow 必须从 owning Core v2 Workflow 读取已归档终态、Role Manifest 和 Event History，生成不可变 Historical Baseline；调用方不能提交伪造 baseline；
- `REQ-0064-03`：历史 Capture 按旧 Provider Session ID 读取显式 allowlist，写独立 raw/normalized/Manifest/Import Receipt；没有 pre-execution Prompt Envelope 时只允许 `PROVIDER_NATIVE_OBSERVED | UNVERIFIED`；
- `REQ-0064-04`：Session Evidence Authority 按 Run 保存 append-only Attempt 链；相同请求幂等复用，冲突请求/Artifact/Receipt 拒绝，后续 Attempt 必须绑定 predecessor Receipt；
- `REQ-0064-05`：Capture 前后必须证明原 Workflow Projection、Domain Event History、Role Manifest、Outcome 和 Archive 状态未改变；不得直接编辑旧 Projection、Manifest、Event 或 Git 历史；
- `REQ-0064-06`：Board/Trace 通过显式 Registry join 展示历史 Session Evidence，不扫描 Provider Home、验收目录或数据库；API 沿用 W05 的 `/session`、`/timeline`、`/events`、`/stderr` 分层；
- `REQ-0064-07`：缺源或不可用必须形成明确终态 Receipt/Disposition，不补造 Prompt 或完整 Transcript；失败不能重跑 Agent、Test、Commit、Merge、Closure 或 Archive；
- `REQ-0064-08`：真实产品验收为 `TASK-CORE-V2-LIVE-006` 七个 Role 创建 7/7 append-only Receipt；重复运行不产生新副作用，冲突被拒绝，原历史逐字节/Digest 不变；
- `REQ-0064-09`：提供无需手工点击的 `npm run acceptance:agent-sessions:history`，保存 Requirement → Execution → Evidence 报告并完成全库门禁。
