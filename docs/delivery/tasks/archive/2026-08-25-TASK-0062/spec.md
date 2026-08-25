# TASK-0062 Spec：统一 Agent Session Timeline 与 Board API

> 状态：Approved
> Spec Revision：1

- `REQ-0062-01`：Board 必须直接消费 Provider Adapter 产出的受管 `NormalizedTimelineEventV1`，不得再次从 raw 或 execution stream 推断对话语义；
- `REQ-0062-02`：API 必须分离 execution stream、normalized transcript、raw artifact metadata 与 stderr，现有 execution endpoint 保持兼容；
- `REQ-0062-03`：Timeline 支持确定性 cursor、limit、刷新和完成状态，相同 Artifact 的分页结果稳定且无重复；
- `REQ-0062-04`：API 明确区分 COMPLETE、PARTIAL、PENDING、WAITING_RECONCILE、UNAVAILABLE 与完整性错误，并返回稳定机器码；
- `REQ-0062-05`：Board 只能读取 Session Evidence Authority 已绑定的 Moye 受管 Artifact，不扫描 Codex/Claude Home，不暴露宿主机路径；
- `REQ-0062-06`：Manifest、normalized transcript 与 stderr 必须在输出前校验 Task/Run/Attempt 绑定、Digest 和字节长度；
- `REQ-0062-07`：使用 W04 已归档真实 Codex Role Session 验证 Board API 能读取完整真实时间线，而不重新运行 Agent。

本 Task 不重做聊天式弹窗、筛选和响应式排版；这些 UI 消费逻辑由 TASK-0063 交付。
