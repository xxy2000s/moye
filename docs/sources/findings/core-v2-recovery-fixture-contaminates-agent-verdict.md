# Core v2 Recovery Fixture 污染了真实 Agent Verdict

> 文档类型：Finding
> 状态：Fixed by TASK-0044
> 发现日期：2026-08-23

TASK-0044 最终复跑的 `TASK-RCV-20260823132058-02-TEST-NOT-APPLIED` 未能作为 NOT_APPLIED 成功证据。Implementation Agent 按要求自行运行 `npm test` 时，Fixture 无条件向仓库外的 Trusted Runner ledger 写入，Codex sandbox 返回 EPERM 并触发合法 Repair；同时 Objective 中 `# Security.` 的句末标点被实现为文件内容，Final Reviewer 正确发现其不满足 Architect 产出的精确 `# Security` 验收标准。Repair 预算耗尽后，该 Task 通过正式 Failure Closure/Archive 收敛为 `CLOSED / FAILED_TERMINAL / ARCHIVED`，失败历史保留。

根因不是 UNKNOWN/Reconcile 协议，而是 Fixture 把“Agent 自测”与“Trusted Runner 执行计数”混在同一副作用中，并使用了可歧义的自然语言。修复包括：

- Trusted Runner 子进程显式设置 `MOYE_TRUSTED_RUNNER_EXECUTION=1`；
- Fixture 只在该标记存在时追加 Trusted execution ledger；
- `npm test` 同时验证 value、README heading 与 SECURITY 完整字节；
- Task Objective 和 Acceptance Criteria 用精确内容及“句号不属于文件内容”消除歧义；
- Harness 不再把合法 Repair/Replan 的新 Generation Role Run 误判成重复执行，而是拒绝重复 Attempt/Run/Session 和同 Generation Checkpoint。

该失败 Task 证明失败终态闭环有效，但不计入 NOT_APPLIED 成功场景。复验证据由 TASK-0044 后续全新 Task key 的真实矩阵提供。
