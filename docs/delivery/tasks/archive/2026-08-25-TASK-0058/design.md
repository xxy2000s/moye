# TASK-0058 Design

> 状态：Accepted

## 证据分层

```text
PromptEnvelopeV1
  → ActiveRoleRunLocatorV1
  → execution-events.jsonl / stderr
  → Provider-native raw session
  → NormalizedTimelineEventV1[]
  → SessionTranscriptManifestV1
  → SessionTranscriptImportReceiptV1
```

执行事件与 Session Transcript 是两个独立 Artifact。前者证明 CLI 进程和执行回执，后者证明 Provider 对话、工具与时间关系；任何一方都不能冒充另一方。

## 权限与生命周期

- 新 Role 在启动外部 Agent 前持久化 Prompt Envelope，并发布 Active Locator；
- `PENDING` 与 `WAITING_RECONCILE` 属于后续 Transcript Workflow 的运行状态，不写入不可变终态 Receipt；
- Receipt 只允许 `COMPLETE | PARTIAL | UNAVAILABLE | FAILED`，并具有 `DIAGNOSTIC_SUPPLEMENT_ONLY` 权限；
- 历史导入由独立 Transcript Enrichment Workflow 和 Session Evidence Authority 管理，不使用 Task recovery successor，也不修改原 Task Projection；
- 同一 source binding 与 capture attempt 生成稳定 operation identity；同内容重放幂等，冲突内容拒绝，后续 attempt 必须链接 predecessor Receipt；
- Capture 未知只恢复或对账 Capture Effect，绝不重新执行 Agent。

## 兼容与隐私

现有 `RoleRunEvidenceV2` 不增加必填字段。新证据通过独立 Artifact 和 Receipt 追加，因此旧 Manifest 继续按原 Digest 解析。Prompt 和 Transcript 分别记录原始内容 Digest 与实际存储内容 Digest；`digest_only` 不持久化正文，`redacted` 保存脱敏正文，`full` 要求存储字节与原始字节一致。

Provider Home 路径不进入公共证据合同。Board 后续只能读取 Moye 受管 Artifact；完整 Prompt、源码与工具输出默认视为敏感数据，非本机暴露必须由后续安全边界显式授权。
