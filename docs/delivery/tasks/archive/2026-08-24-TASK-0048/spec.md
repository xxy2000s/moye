# TASK-0048 Spec：Core v2 全矩阵真实复跑、最终证据与部署验收

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)

- `REQ-0048-01`：提供单一非交互入口，按显式目录运行 Happy、Finding/Repair/Replan、Recovery、Budget/Observer/Fencing 四套真实 suite，并生成统一 Audit Manifest；
- `REQ-0048-02`：原十五项要求各自使用独立的新 Workflow key，并增加本轮真实 Incident 产生的 Role NOT_APPLIED 场景，共十六个执行 Task；全部使用真实 Codex、真实 Restate、真实隔离 Git、真实 Commit/Checkpoint、适用时的真实 Merge、Trusted Runner、Role Session/Event/Artifact，不允许 Fake/Mock/Scenario Adapter 作为产品证据；
- `REQ-0048-03`：Test CONFIRMED/NOT_APPLIED 保存错误 token、幂等重放、冲突 Evidence 与唯一测试执行的显式审计事实；Recovery、Checkpoint、Merge 与 Worker 中断保存 fault marker 和接管事实；
- `REQ-0048-04`：统一 `acceptance:core-v2:matrix` 只能在四套 suite 和 `acceptance:core-v2:audit` 全部成功时退出 0；失败历史原样保留，重跑使用新 key；
- `REQ-0048-05`：最终报告逐场景列出 Task ID、终态、Candidate/Merge Commit、Role Session、Evidence Digest 与 Board 页面链接，并区分单元、Adapter E2E、真实 Restate、真实 Agent 证据；
- `REQ-0048-06`：`npm run check`、`npm run test:e2e`、统一真实矩阵、Docs Impact 与唯一 Result Commit Seal 全部通过；
- `REQ-0048-07`：最终把当前源码服务启动在 `http://127.0.0.1:3000`，Board 可找到最新成功、失败归档和全部新验收历史；
- `REQ-0048-08`：最终文档只按证据表述 Core v2 PoC 已验收范围，并明确多 Daemon Lease/Fencing、远程 Provider/PR、鉴权、多租户、生产观测等未实现能力。

若真实矩阵发现产品缺陷，必须创建真实 Finding/Backlog，并由独立后续实现 Task/Result Commit 修复；不得修改失败 Task 的历史或重复提交其 Workflow key。
