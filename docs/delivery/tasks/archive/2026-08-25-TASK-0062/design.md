# TASK-0062 Design

`src/domain/session-transcript.ts` 中 Provider Adapter 已生成的 `NormalizedTimelineEventV1` 是唯一对话语义 Normalizer。Board 新增只读 Session Timeline resolver：先由 Core v2 Projection 定位 Role Run 与 `sessionEvidence`，再在配置的 Artifact Root 内验证 Receipt、Manifest、binding 与内容 Digest，最后分页返回受管 Timeline。

API 划分为四个互不替代的视图：`/session` 返回状态、完整性和受管 Artifact 元数据；`/timeline` 返回 canonical normalized events；既有 `/events` 继续返回 Agent CLI execution stream；`/stderr` 单独返回受校验的运行错误输出。raw 只返回 descriptor，不内联 Provider 原始内容。

路径解析使用 Board 既有 Artifact Root allowlist 与 realpath containment；API 不接收 Provider Home，无法回退扫描用户目录。等待、缺失与证据损坏用稳定状态和错误码表达，W06 可以直接据此渲染，不复制分类器。
