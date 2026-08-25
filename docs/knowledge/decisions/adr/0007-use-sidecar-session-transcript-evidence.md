# ADR-0007：使用单向 Sidecar 保存 Agent Prompt 与 Provider Session 证据

> 状态：Accepted
> 日期：2026-08-25
> 决策者：Moye Core
> 关联文档：[Core v2 Agent Lifecycle](../../current/architecture/core-v2-agent-lifecycle.md)、[M1 Agent Session Evidence](../../../delivery/milestones/m1-agent-session-evidence.md)

## Context

Core v2 当前的 `RoleRunEvidenceV2`、Role Manifest 和 `execution-intent` 已经由 canonical JSON 与 Digest 封存。它们保存 CLI stdout/stderr 与结构化 Role Output，但没有保存完整 rendered Prompt，也没有固化 Codex/Claude Provider 原生 Session。直接给既有 schemaVersion 1 对象增加字段会改变 canonical bytes 和 Digest，破坏已归档 Evidence；让 Board 扫描 Worker Home 又会把本地缓存误当业务事实，并引入路径、权限、保留期和泄露风险。

Transcript capture 还位于 Agent 外部副作用之后。若采集失败或回执未知就重新执行 Role，会重复昂贵 Agent 操作，违反未知副作用必须先 Reconcile 的核心不变量。

## Decision

采用单向、append-only Sidecar 证据链：

```text
PromptEnvelopeV1（Agent 启动前）
  → 既有 Role Manifest（保持原 schema 与 Digest）
  → SessionTranscriptManifestV1
  → SessionTranscriptImportReceiptV1
```

1. 不修改 `RoleRunEvidenceV2`、既有 Role Manifest 或 execution-intent schema；旧对象不反向引用 Transcript。
2. 新 Role 必须先持久化 Prompt Envelope，再发布 Active Role Run Locator，最后才允许写 execution intent 并启动 Agent。
3. Prompt Envelope 只记录真实独立片段；实际发送给 CLI 的 rendered Prompt 与 Agent Invocation 共用唯一 `renderRoleAgentPromptV2`，并以 UTF-8 精确字节 Digest 绑定 `PreparedRealRoleRunV2`。不得把事后重建、模板推断或只复制 Run/Request ID 冒充 pre-execution Evidence。
4. Agent 完成后由独立 Transcript Capture Effect/Workflow 固化 Provider raw snapshot（仅 `full`）和版本化 normalized timeline，再形成不可变 Manifest 与 Receipt。
5. Receipt 的权限恒为 `DIAGNOSTIC_SUPPLEMENT_ONLY`。Session Evidence Authority 只能 append、fence 和查询补充证据，不能推进 Task、改变 Verification Gate、Merge、Closure、Archive 或令旧 Revision/Generation Evidence 复活。
6. `PENDING` 和 `WAITING_RECONCILE` 是 Capture Workflow 运行状态；Receipt 只记录 `COMPLETE | PARTIAL | UNAVAILABLE | FAILED` 终态。
7. Capture UNKNOWN 只对账或重放相同 Capture Effect。Artifact 完整且 Digest 一致时确认；完全不存在时经 `NOT_APPLIED` 后重做 Capture；冲突内容拒绝。任何分支都不返回 Role execution。
8. 每个 Capture Attempt 必须使用唯一 enrichment Workflow key 和唯一 raw、normalized、Manifest、Receipt refs；Authority 的 active locator、终态 history 与反序列化信任边界都拒绝跨 Attempt 复用。
9. 历史导入绑定旧 `roleManifestRef + roleManifestDigest` 并追加独立 Receipt。可由 Provider 原生记录直接观察到 Prompt 时标记 `PROVIDER_NATIVE_OBSERVED`；否则为 `UNVERIFIED`，绝不补造 Prompt Envelope。

## Capture 与隐私策略

- 默认 `digest_only`：只保存原始字节 Digest 和长度，不落正文；
- `redacted`：保存确定性脱敏后的 normalized 内容、脱敏规则版本和 Digest，不保存 raw；
- `full`：显式 opt-in，保存 exact-byte raw 与完整 normalized 内容；M1 隔离产品验收使用该模式；
- Digest 只证明完整性，不提供保密；完整 Prompt、源码、工具输出和 Provider 暴露的 thinking 都按敏感数据处理；
- Artifact 合同不持久化 Provider Home 绝对路径，Board 只能读 Moye 受管 Artifact；非 loopback 展示需要后续鉴权边界。

`MOYE_CAPTURE_USER_PROMPTS` 继续只是 Claude OTel legacy 开关，不能暗中改变 Session Artifact 的冻结策略。

## Normalization

normalized timeline 按 Provider 源记录顺序形成连续 sequence，不按可能缺失或无效的时间戳重排。每条事件绑定 raw record Digest、record sequence 和 part index；Provider user message 只有与 rendered Prompt Digest 精确相等时才标为 `PROMPT`。Claude `role=user` 中仅含 tool result 的记录必须标为 Tool Result，不能展示成人类对话。Provider 暴露的 thinking 只能标明“Provider exposed”，不得声称是完整内部推理。

Parser name/version/options 进入 capture identity。解析语义改变时创建新的 append-only capture，不覆盖旧 Artifact。同 operation 相同 Evidence 幂等，不同 Digest 冲突；后续 capture attempt 必须链接 predecessor Receipt。

## Consequences

- 旧 Role Evidence byte-for-byte 兼容，新能力不会制造 Digest 环；
- Prompt 写失败发生在 Agent 启动前，可以安全失败或重试；Agent 启动后的 Transcript 故障不会重复 Agent；
- Board 和历史补全必须增加显式 Authority/Workflow join，不能用目录扫描捷径；
- `COMPLETE` 只表示按所选 policy 完成 Provider 暴露的数据，不证明获得未暴露或加密的模型内部 reasoning；
- raw Artifact 增加敏感数据保留、权限、清理和部署安全成本，生产鉴权与保留策略仍属于后续范围。

## Rejected

- 给 Role Manifest v1 增加 Transcript 字段：破坏历史 canonical Digest，并形成双向引用；
- 把 CLI stdout Viewer 改名为完整 Session：没有补齐原始 Prompt、Provider 工具关系和源级证据；
- Board 实时递归扫描 Provider Home：本地缓存不可迁移、不可授权且不能形成稳定 Artifact；
- Transcript 失败后进入 Implementation Repair：采集故障不是产品实现 Finding，且会重复 Agent；
- 对历史 Session 重建 Prompt Envelope：事后推断不能冒充当时存在的 pre-execution Evidence。
