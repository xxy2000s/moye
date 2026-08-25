# TASK-0061 Spec：Core v2 Session Evidence Runtime Integration

> 状态：Accepted
> Spec Revision：1

- `REQ-0061-01`：每个启用 Session capture 的真实 Role Run 必须在 Agent 进程启动前持久化 Prompt Envelope，并与 Prepared Role Request 精确绑定；
- `REQ-0061-02`：Core v2 Projection 在 Agent 启动前发布 PREPARED/RUNNING Active Locator，完成后发布确认 Session 与 CAPTURE_PENDING；
- `REQ-0061-03`：Agent 完成后由独立、幂等 Capture Effect 固化 Provider raw/normalized/Manifest/Receipt，Core Projection 只连接受管 Evidence Authority；
- `REQ-0061-04`：Capture Intent-only 或回执未知时只恢复/对账同一 Capture，不得重新运行 Agent；相同 Evidence 幂等，冲突 Evidence 拒绝；
- `REQ-0061-05`：Role execution events 与 stderr 保持独立 Artifact 引用，Transcript 不覆盖 CLI execution stream；
- `REQ-0061-06`：旧 Attempt/Revision/Generation 的迟到 Capture 不能覆盖当前 Candidate 或获得 Gate 权限；Transcript 始终为 `DIAGNOSTIC_SUPPLEMENT_ONLY`；
- `REQ-0061-07`：真实 Restate + 真实 Codex/Claude 至少形成一个完整 Runtime Session Evidence 链，并验证受控 Capture 中断不会产生第二个 Agent Run。

不在本 Task 实现 Board Timeline API、Chatbot UI 或历史 LIVE-006 enrich；分别由 W05～W07 交付。
