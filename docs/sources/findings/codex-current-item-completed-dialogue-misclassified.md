# Codex 当前 item_completed 对话记录被误归为 System

> 文档类型：Finding
> 状态：Resolved
> 发现日期：2026-08-25
> 修复 Task：TASK-0061

`TASK-0061` 第一次真实 Restate + Codex Session Capture 验收中，`TEST_PLAN` 的原生 rollout 使用当前 Codex 格式：`event_msg/item_completed` 内含 `UserMessage`、`AgentMessage`，同时 `response_item/message` 使用 `output_text` 保存 Assistant 输出。旧 Parser 只识别 `event_msg/user_message|agent_message`，因此把真实 Assistant 消息归为 System，最终以 `messages=UNAVAILABLE` 触发 `TRANSCRIPT_COMPLETE_WITH_GAPS`。

失败 Workflow `TASK-RCV-20260825185538-01-SESSION-CAPTURE`、原 Attempt、Session `01a03a4a-8bfa-7f82-a98e-6716640c66e5`、Role Manifest 和已完成的前序 Transcript 均保留在 Restate 与验收 Artifact 中；没有删除或覆盖历史。修复后 Parser 明确识别 `item_completed` 的 `UserMessage/AgentMessage` 与 `response_item` 的 Assistant `output_text`，并用真实新格式回归用例固定分类。

新 key `TASK-RCV-20260825190550-01-SESSION-CAPTURE` 随后完成七个真实 Role、七个 Prompt Envelope、七个原生 Transcript Receipt、真实 Trusted Test、Merge、Closure 与 Archive；首个 Capture Manifest 后的强制 Service 终止没有产生第二个 Agent Run。
