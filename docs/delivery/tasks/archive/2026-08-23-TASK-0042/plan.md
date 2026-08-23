# TASK-0042 Plan

1. 冻结 Success Closure、Archive Effect/Receipt 与 Archive-only retry 领域协议；
2. 接入 CoreV2Workflow 成功 Closure/Archive，并修正 Board/Trace 的归档映射；
3. 实现 Core v2 journaled command failure 的 Authority、successor Workflow 与 CLI；
4. 以 unit/E2E 验证 digest/token/fencing、幂等和不重跑主流程；
5. 合法收敛 001/003/004，并运行一个具真实 Success Archive Receipt 的真实 Agent Task；
6. 更新 Architecture、CodeMap、Runbook、Roadmap、Finding/Backlog 和 Docs Impact；
7. 运行全库门禁，创建唯一 Result Commit并提交 Seal Evidence。
8. 修复真实历史详情验收发现的 nullable schema 兼容问题，并用 LIVE-001～004 Trace API 回归。
