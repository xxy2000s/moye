# TASK-0032 Design

纯领域 `role-runtime-v2` 负责 Attempt/Generation/状态/Event/Unknown/Reconcile，不依赖进程或文件系统。Agent Adapter 只消费可信 RUNNING Attempt，规范化 Scope 和 Artifact Root，写稳定 `execution-intent.json` 后才启动 argv-only Codex/Claude 子进程。完整 Manifest 按 Run ID 对账并重算 events/stderr/output digest；Intent-only 不启动进程。

角色权限固定：Architect、Test/Verification、Review、Observer 只读；Implementation 和 Documentation 可写受管 Scope。Role/Phase 组合固定，两次 Review 和两阶段 Test 都是不同 Attempt。`NOT_APPLIED` Reconcile 仅产生 `RETRY_NEW_ATTEMPT` 回执，由 Workflow 创建 Generation N+1；Adapter 永不删除 Intent 或自行复活旧 Attempt。
