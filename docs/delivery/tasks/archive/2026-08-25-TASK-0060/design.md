# TASK-0060 Design

Claude Adapter 复用 W01 Sidecar 合同和 W02 安全边界，但 Provider parser 独立版本化。Locator 以确认 `sessionId` 匹配记录字段和主 Session 文件名；Subagent 文件通过 `sessionId + agentId` 作为层级证据，不替代 Moye Attempt/Run 主链。Parser 以 `message.content` block 为语义单位，并保持 JSONL 源顺序和 uuid/parentUuid 因果引用。

捕获仍是 Task 状态机之外的受限 Effect；W03 不接入 Workflow，也不允许 Board 扫描 `~/.claude/projects`。

真实验收发现 Claude CLI 的 final record 同时包含面向人的 `result` 文本与通过 `--json-schema` 生成的 `structured_output` 对象。Role Runtime 必须优先验证后者；只有字段不存在时才兼容旧文本。这是 W03 真实 Role 产品验收的前置阻断修复，失败 Session 和 Manifest 继续保留，不用新字段改写历史。

Parser 将无时间戳的 Provider metadata 保留为 System Event，但 `COMPLETE.timestamps` 只声明 Prompt、对话和工具等核心事件都具有 Provider 时间；不会为 permission mode 等无时间记录伪造时间戳。模型、message id、stop reason、sidechain 与 agentId 形成独立 Provider metadata part，避免污染 Assistant 正文。
