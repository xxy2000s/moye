# ADR-0009：分离 Session 内容完整性与 Prompt 绑定可信度

> 状态：Accepted
> 日期：2026-08-27
> 决策者：Moye Core
> 关联文档：[ADR-0007](./0007-use-sidecar-session-transcript-evidence.md)、[Core v2 Agent Lifecycle](../../current/architecture/core-v2-agent-lifecycle.md)、[M3](../../../delivery/milestones/m3-backlog-and-session-clarity.md)

## Context

ADR-0007 的 Transcript v1 需要用单一 `captureState` 表达 Artifact 终态。历史 Enrichment 没有 pre-execution Prompt Envelope，因此 Adapter 合法地保存 `captureState=PARTIAL`、`promptBinding=UNVERIFIED` 和一个稳定 Parser error；即使 Provider 消息、时间戳、层级、工具和解析指标完整，Board 也只能把这一组合显示成通用“记录不完整”。这把 Evidence 可读性、内容缺失、Prompt/Attempt 强绑定可信度和 policy/provider 能力边界混成了一个状态。

既有 Receipt、Manifest、Projection、Event、Artifact 与 Digest 已经封存。回写字段、改变 v1 枚举解释或用新 Digest 替换旧对象都会破坏历史审计；让 UI 各自拼装判断又会产生跨页面语义漂移。

## Decision

建立版本化、只读的 `SessionEvidenceSemanticsV1` 派生视图，由 Domain 唯一计算并由 Board API 传输：

1. Availability：`PENDING | AVAILABLE | WAITING_RECONCILE | UNAVAILABLE | FAILED`，回答受管 Evidence 当前是否可读；原始 `COMPLETE | PARTIAL` 都只表示存在可读 Manifest，因此映射为 `AVAILABLE`。
2. Content Completeness：只在 `AVAILABLE` 时评估 `COMPLETE | PARTIAL`。它逐项读取消息、工具、时间戳、层级、raw、Parser metrics、终止标记和 Capture errors，并返回稳定 reasons；不直接复用 legacy `captureState`。
3. Binding Confidence：`VERIFIED | UNVERIFIED | NOT_APPLICABLE`。只有当 Transcript 绑定 pre-execution `PromptEnvelopeV1` 时为 `VERIFIED`；Provider 原生观察和历史无法追溯均为 `UNVERIFIED`，不能由可读正文提升。
4. Limitation：`REDACTED | OMITTED_BY_POLICY | NOT_EXPOSED | NONE`。policy/provider omission 不计为 data loss；多个限制保留完整 reasons，主值按上述顺序确定。
5. 不可用或完整性校验失败时 Content 显式 `evaluated=false`，不得伪造 `COMPLETE/PARTIAL`；Binding 为 `NOT_APPLICABLE`。
6. Transcript v1 历史 Prompt gap 的 `UNSUPPORTED_FORMAT/PARSER` 只有在 `detailDigest` 精确匹配既有确定性 sentinel 时属于 Binding 而非 Content。任何其他同 code/scope 错误继续形成真实内容原因。
7. 旧 raw diagnostics 继续原样返回。派生视图不持久化、不参与 Evidence Digest、不反向引用旧 Artifact，也不能推进 Workflow、Gate、Closure 或 Archive。

本 ADR 补充而不替代 ADR-0007：ADR-0007 继续定义写入和 Sidecar 权限边界，本 ADR 定义产品读取与展示的语义边界。未来若改变持久化 Transcript 枚举或错误 scope，必须使用新的 Artifact schema/version，而不能把新值塞入 v1。

## Consequences

- 历史 `PARTIAL + UNVERIFIED` 在内容无缺口时稳定表达为 `AVAILABLE + COMPLETE + UNVERIFIED`；原始事实仍可在高级诊断审计。
- 真正的解析、未知、丢弃、截断、终止标记或内容维度缺口保持 `PARTIAL` 并有逐项原因。
- Board resolver/API/UI 消费同一分类器，页面不再拥有隐式领域规则。
- 新视图是向后兼容的 API 增量；旧消费者仍可读取原始字段。

## Rejected

- 重写历史 Manifest/Receipt 为 `COMPLETE`：破坏 Digest 和 append-only Evidence 边界；
- 把所有 `UNSUPPORTED_FORMAT` 都视为 Binding：会洗白真实 Parser 故障；
- 让 UI 根据文案或 `promptBinding` 临时修正：不同消费者会得到不同结论；
- 在 Transcript v1 中新增未版本化 error code/scope：旧 parser 无法安全读取新 Artifact。

