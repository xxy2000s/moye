# TASK-0059 Spec：Codex Provider 原生 Session Adapter

> 状态：Accepted
> Spec Revision：1

- `REQ-0059-01`：只能在显式 allowlist 的 Codex Session Root 中按 Role Manifest 已确认的 `thread_id` 定位唯一 rollout JSONL；
- `REQ-0059-02`：在解析前完成安全、稳定、内容寻址的原始快照，并产生受管 raw 与 normalized Artifact；
- `REQ-0059-03`：规范化 Prompt/User、Assistant、Tool Call/Result、Provider System/Thinking、时间戳和父子 Thread 关系；
- `REQ-0059-04`：Prompt 必须与 Prompt Envelope 的实际 rendered Prompt 精确匹配，Manifest 精确绑定 Task/Workflow/Revision/Generation/Attempt/Run/Session/Provider；
- `REQ-0059-05`：Provider 源文件移除后，受管 Artifact 仍可独立读取和验证；
- `REQ-0059-06`：路径越界、符号链接、非普通文件、超限、重复 Session、Session ID 不匹配和 Malformed JSONL 必须 fail closed；
- `REQ-0059-07`：用真实 Codex CLI Role Run 生成产品验收证据；Fake/Mock 只能补充 Parser 边界测试。
