# TASK-0061 Design

Core v2 owning Workflow 仍是 Task 主状态唯一写者。Role 开始前，它用统一 renderer 形成 `PromptEnvelopeV1`，通过单独 durable command create-once 写入受管 Artifact，并把版本化 `ActiveRoleRunLocatorV1` 投影到当前 Role Run。

Role durable command 与 Transcript Capture durable command分离。Agent Manifest 确认后，Workflow 只把 Locator 推进到 `AGENT_COMPLETED → CAPTURE_PENDING`，再调用以 Capture Operation 为身份的幂等 Effect。Effect 先持久化 Intent，复用 Codex/Claude Provider Adapter，生成 Receipt；Intent-only、Manifest-only 和 Receipt 丢回执都从受管 Artifact 对账，不回到 Role Runtime。

Projection 保存 Prompt descriptor、Locator、Receipt 与 Session Evidence Authority 摘要，不保存 Provider Home 路径，也不让 Transcript 参与 Verification、Merge、Closure 或 Archive Gate。W04 只接入 LIVE capture；W07 复用同一 Authority 增加历史 append-only enrichment。
