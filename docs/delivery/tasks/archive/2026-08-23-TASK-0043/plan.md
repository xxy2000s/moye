# TASK-0043 Plan

1. [x] 定义真实 acceptance profile 的权限、Revision/Generation/Phase 绑定和拒绝规则；
2. [x] 修正 Finding/Repair/Replan 中暴露的 Workflow Evidence 绑定缺口并补 unit/E2E；
3. [x] 实现隔离 Restate/Git/Codex acceptance harness 和结构化 Evidence auditor；
4. [x] 运行 Happy Path，并顺序运行 Implementation、Final Review、Documentation、Test、Design Replan 五个真实故障场景；
5. [x] 为每个 Runtime Task 固化 Input、Attempt、Session、Event、Checkpoint、Test、Review、Gate、Merge、Closure、Archive 与 Board/Trace 摘要；
6. [x] 更新 Architecture、CodeMap、Runbook、Roadmap、Finding/Backlog 与 Task Verification；
7. [x] 运行 `npm run check`、`npm run test:e2e`、两个真实 acceptance 入口和 Docs Impact；
8. [x] 准备唯一 Result Commit package；Commit SHA 与最终 Seal 业务结果由 Runtime Receipt 保存。
