# Core v2 Repair 后旧 Generation Evidence 缺少显式失效账本

> 文档类型：Finding
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23

在为 TASK-0043 编写真实 Final Review Finding 与 Test Failure 产品验收审计时，确认 `workflowAuthorizeRepairV2()` 会从当前 `artifacts` 中移除旧 Generation 的 `DOCS_IMPACT`、`TEST_PLAN`、`TEST_REPORT` 与 `FINAL_REVIEW`，并把单值 `trustedTestRun` 清空。Role Manifest 和文件仍在 Artifact Root，但 Lifecycle Projection 没有像 Replan 的 `invalidatedRevisions` 一样留下明确的 Generation 失效关系，也无法只根据 Projection 枚举所有真实 Trusted Test 执行。

这会削弱“旧 Evidence 被保留但不能通过新 Gate”的可查询证明，尤其无法可靠区分测试未执行与旧失败测试已失效。TASK-0043 增加 append-only `trustedTestRuns` 执行账本与 `invalidatedGenerations`，记录旧 Candidate、Checkpoint、Artifact refs、Trusted Test ref 和 Repair 原因；当前 Gate 继续只读取活跃 Generation Artifact，不允许旧 Evidence 参与新 Gate。

真实 Final Review、Documentation 和 Test Failure 场景均已产生 Generation 0/1 历史；最终 Projection 能枚举旧 Candidate 与测试 Manifest，同时 Gate 只绑定 Generation 1。Test Failure 场景尤其证明退出码 17 的 G0 Manifest 被保留但未进入最终 Gate。
