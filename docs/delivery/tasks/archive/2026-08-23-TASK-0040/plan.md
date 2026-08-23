# TASK-0040 Plan

1. 冻结 Failure Artifact、Closure、Archive Receipt 与状态转换契约；
2. 实现新 Core v2 失败任务的 owning Workflow 收束和 Archive-only retry；
3. 实现 TaskAuthority 授权的 append-only 历史 recovery successor；
4. 修正 Board/Trace/CLI 对 Core v2 successor 与失败归档状态的解析；
5. 以单元测试覆盖 reducer、fencing、幂等与 Archive Failed；
6. 以真实 Restate E2E 恢复 LIVE-001～004，并保存每项 Runtime Evidence；
7. 更新 Architecture、CodeMap、Runbook、Roadmap、Docs Impact，完成 Result Commit 与 Seal。
