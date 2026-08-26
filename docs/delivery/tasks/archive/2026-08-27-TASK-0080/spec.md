# TASK-0080 Spec

> 状态：Approved
> Backlog：[BL-0083](../../../backlog/BL-0083.yaml)
> Milestone：[M3 W04](../../../milestones/m3-backlog-and-session-clarity.md)

## 目标

冻结 Session Evidence 的四维派生语义，使同一份不可变 Receipt、Manifest 与 Authority 在 Domain、Board API 和后续 UI 中得到唯一分类，同时保留历史原始 `PARTIAL`、`UNVERIFIED`、Error 与 Digest 供诊断，不回写任何既有 Evidence。

## Requirements

- `REQ-0080-01`：定义版本化的只读语义视图，分别表达 Availability、Content Completeness、Binding Confidence 与 Limitation；Board/UI 不得自行从原始字段猜测。
- `REQ-0080-02`：`COMPLETE | PARTIAL` 原始 Receipt 均映射为 `AVAILABLE`；只有可用 Evidence 才评估 Content，解析错误、未知/丢弃事件、终止标记和消息/时间/层级/工具/raw 内容缺口形成稳定原因。
- `REQ-0080-03`：历史 `UNVERIFIED` 或 `PROVIDER_NATIVE_OBSERVED` 不降低 Content Completeness；具备完整消息、时间、层级与 Parser 指标的历史补全映射为 `AVAILABLE + COMPLETE + UNVERIFIED`。
- `REQ-0080-04`：`digest_only`、`redacted` 与 Provider `NOT_EXPOSED` 分别映射为 `OMITTED_BY_POLICY`、`REDACTED`、`NOT_EXPOSED` limitation，不能作为数据丢失；多重限制保留稳定原因，主 limitation 使用确定性优先级。
- `REQ-0080-05`：`PENDING`、`WAITING_RECONCILE`、`UNAVAILABLE`、`FAILED` 与 Artifact integrity failure 保持独立 Availability；不可用时 Content 不伪造为 `COMPLETE` 或 `PARTIAL`，Binding 为 `NOT_APPLICABLE`。
- `REQ-0080-06`：兼容映射只消费已验证的 Authority/Receipt/Manifest；旧 `UNSUPPORTED_FORMAT/PARSER` 仅在 detail Digest 精确匹配历史 Prompt-binding 占位错误时排除出内容缺口，其他同名错误仍为真实内容原因。
- `REQ-0080-07`：原始 Manifest、Receipt、Projection、Event、Artifact 与 Digest 不变；新语义是 API 派生字段，不形成反向引用或新的主状态。

## 非目标

- 本 Task 不实现 Session Dialog 文案和视觉层，交由 TASK-0081；
- 不把历史 `UNVERIFIED` 提升为 `VERIFIED`；
- 不修改 Transcript v1 的持久化枚举或重写新旧 Capture Artifact；
- 不用 Provider Home 扫描或低层 Fake 冒充真实 Session Evidence。
