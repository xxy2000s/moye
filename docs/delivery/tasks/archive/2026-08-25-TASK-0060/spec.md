# TASK-0060 Spec：Claude Provider 原生 Session Adapter

> 状态：Accepted
> Spec Revision：1

- `REQ-0060-01`：只在显式 Claude Projects allowlist 内按 Role Manifest 已确认 `sessionId` 定位唯一物理 JSONL；
- `REQ-0060-02`：稳定快照并固化 raw、normalized、Manifest，源移除后仍可按 Digest 读取；
- `REQ-0060-03`：规范化 user/assistant text、thinking、tool_use、tool_result、timestamp、uuid/parentUuid、Subagent/agentId 和模型元数据；
- `REQ-0060-04`：仅含 `tool_result` 的 Claude `role=user` 记录必须归类为 Tool Result，不能冒充人的对话；
- `REQ-0060-05`：越界、符号链接、超限、坏行、Session 漂移和重复源 fail closed；写入相同内容幂等、冲突拒绝；
- `REQ-0060-06`：使用真实 Claude CLI Role Run 形成 Prompt、Assistant、Tool 与 Session Digest 产品证据。
