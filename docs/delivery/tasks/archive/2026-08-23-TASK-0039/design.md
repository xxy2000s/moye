# TASK-0039 Design

`CoreV2Workflow/<task_id>` 是唯一编排者，逐阶段创建 Role Attempt，在 Restate durable `ctx.run` 内调用真实 Role Runtime、受信任 Git checkpoint 或 Trusted Runner，再把完成结果交给纯 Lifecycle Reducer。每个阶段更新同一 Projection 和 ProjectBoard；CLI 与 Web 只读该 Projection。

Architect/Design Review 按 Spec Revision 循环；Design Finding 通过 `workflowReplanV2` 失效旧 Artifact 并创建 R+1。Implementation、Documentation、Test Assessment 或 Final Review Finding 统一进入 `REPAIR_REQUIRED`，授权 Generation N+1 前清除旧 Candidate 的下游 Docs/Test/Review/Gate 证据，保留旧 Attempt 与 Checkpoint。

Implementation Agent 只写 Workspace；Workflow 用 parent、Task/Generation trailer 和 clean tree 对账后创建或复用唯一 Candidate Commit。Test Agent 的 Case 意图由 Workflow 规范到稳定 ID、合法 category 和输入中预授权 argv；Trusted Runner 的 Intent-only 进入 `WAITING_RECONCILE`，只有带精确 token、action 和外部 Evidence 的 `core-v2-reconcile` 才能恢复。

Board Trace 由 Lifecycle Event、Attempt、Session、Artifact 和确定性 Observer 重建完整状态机。Role Event 文件必须同时通过配置根 allowlist、realpath、普通文件和内容摘要校验；节点预览与 Chatbot 弹窗直接分页读取，并按对话、工具调用、工具结果、系统和错误筛选，不提供 Event 下载跳转。
