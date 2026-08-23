# TASK-0044 Design

> 状态：Implemented and verified

验收继续使用真实 `CoreV2Workflow` 与 `CODEX_EXEC`。受控故障只作用于外部操作和 Restate command 回执边界：Trusted Runner 在持久化 Intent 后或完整 Manifest 后制造 UNKNOWN；Git Checkpoint 在 Commit 已满足可对账事实后终止 Service；Merge 在 `update-ref` 成功后终止。重启同一 deployment URI 后由 Restate 重放并读取 ledger、Manifest 或 Git DAG，禁止第二次昂贵操作。

Test `CONFIRMED` 必须从摘要匹配的真实 Manifest 恢复；`NOT_APPLIED` 必须证明只有 Intent、没有执行/Manifest，再授权同一 Run ID 唯一首次执行。稳定 token 的错误、相同 Evidence、冲突 Evidence 分别表现为拒绝、幂等和冲突。

Acceptance harness 控制专用 Moye Service 生命周期、等待精确边界、提交 reconcile、重启并审计 Session、测试 argv、Candidate/Merge DAG、Event/Projection 与 Archive。Harness 不写 Projection，Fake/Mock 只可作为低层补充。
