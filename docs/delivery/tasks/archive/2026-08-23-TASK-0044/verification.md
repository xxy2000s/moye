# TASK-0044 Verification

> 状态：Accepted
> 验证日期：2026-08-23

## 证据等级与范围

本 Task 使用真实 `CODEX_EXEC`、持久化 Restate、独立 Git 仓库、真实 Candidate/双父 Merge、真实 Trusted Runner `npm test`、Role Session/Event、内容寻址 Artifact、Closure 和 Archive Receipt。`recoveryControl` 只在显式授权的专用 acceptance Service 中生效；它只终止真实 Service 的回执边界，不替换 Agent、Runner、Git、Workflow、Gate 或 Projection。

正式产品证据根为 `.moye-runtime/acceptance/core-v2/recovery-20260823142107-40380`。五个新 Workflow 均得到 `CLOSED / SUCCEEDED / ARCHIVED` 唯一终态。该运行在五场景摘要落盘后暴露 Harness 进程清理挂起；随后零场景清理验证 `.moye-runtime/acceptance/core-v2/recovery-20260823145419-37023` 以退出码 0 证明修复，但其 `validationKind=HARNESS_CLEANUP_SMOKE`，不计作产品场景证据。

本 Task 不覆盖 Repair/Replan 预算、Observer/Knowledge 故障和 stale Attempt；这些仍由 TASK-0045 验收，因此不能据此宣称完整故障矩阵完成。

## Requirement → Scenario → Execution → Evidence

| Requirement | 真实 Runtime Task | 关键执行与唯一性约束 | 最终 Evidence | 结果 |
|---|---|---|---|---|
| REQ-0044-01/06/07 | `TASK-RCV-20260823142107-01-TEST-CONFIRMED` | 测试命令与 Manifest 已真实完成后 Service 退出；进入 `WAITING_RECONCILE`；以 token `sha256:5bc060…18030` 和同一 Manifest `CONFIRMED`；测试执行账本仅 1 条 | Candidate `2265e43…d91c1`；Merge `8f56e35…beac`；Test `sha256:4d9160…a18`；Gate `sha256:389ea5…3fd9`；Closure `sha256:2435d7…5786`；Archive `sha256:8809ad…010c`；Projection `sha256:c2701d…683f5` | PASS：没有第二次测试 |
| REQ-0044-02/06/07 | `TASK-RCV-20260823142107-02-TEST-NOT-APPLIED` | 只持久化 Intent 后 Service 退出；错误 token 被拒；正确 `NOT_APPLIED` 后只执行一次；相同 Evidence 幂等；冲突 Evidence 拒绝 | Candidate `87b4a54…711d`；Merge `683933f…c55`；Test `sha256:75c268…5613`；Gate `sha256:027c2a…d25b`；Closure `sha256:c00d28…b37`；Archive `sha256:211fdb…e34f`；Projection `sha256:339cd1…703e` | PASS：唯一首次测试 |
| REQ-0044-03/06/07 | `TASK-RCV-20260823142107-03-ROLE-RECOVERY` | Architect、Implementation、Final Review 的完整 Role Manifest 落盘后分别终止 Service；Test 边界由前两场景覆盖；Restate 恢复同一 durable command | Candidate `e691aed…c939`；Merge `c886ff5…0f2e`；Test `sha256:285a20…972`；Gate `sha256:f98c67…b26f`；Closure `sha256:decfd5…337`；Archive `sha256:b2c069…031e`；Projection `sha256:b836ae…cbe4` | PASS：7 个 Attempt/Run/Session 各唯一 |
| REQ-0044-04/06/07 | `TASK-RCV-20260823142107-04-CHECKPOINT-UNKNOWN` | Candidate Commit 已创建后 Service 退出；恢复按 parent、tree、message/trailer 和 clean worktree 对账；Candidate/Checkpoint 各 1 个 | Candidate `02e6c77…4806`；Merge `6d037eb…68a`；Test `sha256:b18e17…59e5`；Gate `sha256:413356…4530`；Closure `sha256:72b224…d2c3`；Archive `sha256:c7def6…0997`；Projection `sha256:fe0060…c9df` | PASS：没有第二个 Candidate |
| REQ-0044-05/06/07 | `TASK-RCV-20260823142107-05-MERGE-UNKNOWN` | 双父 Merge 与 target ref 更新后 Service 退出；恢复从 Git DAG/ref/marker 对账为 `ALREADY_APPLIED`，`reconciledAfterUnknown=true` | Candidate `98298dc…bbc`；Merge `75e0690…d3e`；Test `sha256:a818bb…55e9`；Gate `sha256:226395…c3bf`；Closure `sha256:570972…59ca`；Archive `sha256:523a36…80b2`；Projection `sha256:a30c5d…3fac` | PASS：目标分支唯一真实 Merge |
| REQ-0044-08 | Recovery Harness 与全库门禁 | `acceptance:core-v2:recovery` 生成新 Task key、强断言副作用唯一；清理 smoke 独立标注，不冒充产品证据 | `matrix-summary.json`、五份 `evidence-summary.json`、最终 Projection/Trace、Service log、故障 marker、测试执行账本 | PASS |

每个 `evidence-summary.json` 都包含 Task Input、Task ID、Workflow Ref、Invocation、Spec Revision/Generation 可由 Projection 重建、所有 Role Attempt/Session/Run/Manifest、Event/Trace、Candidate、Test Manifest、Merge Receipt、Gate、Knowledge Disposition、Closure、Archive、Projection Digest 和页面 URL；原始 stdout/stderr/exit code 与 argv 位于对应 Trusted Runner Manifest。`final-trace.json` 与 `final-projection.json` 用于核对 Projection/Event History 一致。

## Role Attempt / Session 索引

以下每个 Attempt 均为 `r1.g0`，完整 Run ID、Manifest Digest 和 Events Digest 在对应 `evidence-summary.json` / `final-trace.json` 中：

| Task | Architect | Design Review | Implementation | Documentation | Test Plan | Test Assessment | Final Review |
|---|---|---|---|---|---|---|---|
| `…01-TEST-CONFIRMED` | `01a02eff-2a89-7cd1-8e4e-409ced756975` | `01a02f00-1042-7080-8026-9d2784c3f649` | `01a02f00-adde-7290-b869-b2119901f00e` | `01a02f02-4417-75b2-b7ea-7218a039ad42` | `01a02f03-4be6-7f93-bff2-57d78f89c1ca` | `01a02f03-9112-7ce1-8ad2-9b2e40c2dffc` | `01a02f03-dd32-7002-b43e-76e6231d30d2` |
| `…02-TEST-NOT-APPLIED` | `01a02f04-d647-7893-829b-d2ce03de0daa` | `01a02f05-9b40-7a83-bb96-adafea45f348` | `01a02f06-027c-7bc1-b183-69c88a9ba809` | `01a02f06-ee60-76a2-a08a-e42a4f4da492` | `01a02f07-eaeb-75f2-bb43-eff4f4cca1a9` | `01a02f08-491c-76a3-b36a-4aa55ebb9779` | `01a02f08-aa50-7950-8954-144808fb5c34` |
| `…03-ROLE-RECOVERY` | `01a02f0b-180e-7d60-9901-e11442744654` | `01a02f0b-cfd0-7ff2-b836-7082ce74ef7e` | `01a02f0c-1742-7171-a5c5-3845e06629be` | `01a02f0d-71f1-7ae0-b1ad-ee4bbdb15b0b` | `01a02f0f-2dbf-7ac0-8fdc-69e815963c35` | `01a02f0f-688c-7d00-83f4-4d6378e2b941` | `01a02f0f-a7ea-7373-8e24-09a67fd08007` |
| `…04-CHECKPOINT-UNKNOWN` | `01a02f10-a0c2-7e41-804f-d2ee079b8fb5` | `01a02f11-6930-76b1-88d5-292de428c2b9` | `01a02f11-c1c8-70e3-a9f5-65dd8257fc84` | `01a02f13-1954-7202-aede-b57ca3fb4054` | `01a02f14-f32c-7b23-bd8c-dac1deb97ae4` | `01a02f15-452e-73f1-864f-819a6d0cd7d4` | `01a02f15-886f-7740-a111-09c48bc66591` |
| `…05-MERGE-UNKNOWN` | `01a02f16-4e1f-7400-bb31-c7285cef2ab4` | `01a02f17-02c7-7c40-81fe-a160f3249fe6` | `01a02f17-4a75-7bd0-b18d-e559ef2add97` | `01a02f18-2464-7e21-bc22-86a5095c2e02` | `01a02f18-f718-72f3-bec2-6efae7759762` | `01a02f19-3ef5-7620-bed1-be17b436a2b0` | `01a02f19-7ed2-7371-b3e5-894b121f6107` |

Attempt ID 使用稳定格式 `<完整 Task ID>.<PHASE>.r1.g0`，而不是另建匿名执行记录。

## 唯一性与 fencing 审计

- 每场景强制校验 Attempt ID、Run ID、Session ID 不重复；Role Manifest 已存在时只校验并复用，不再调用 Agent；
- `trustedTestRuns` 与外部执行账本均为 1 条；Manifest 重放会重新校验 stdout/stderr 原始字节摘要；
- 当前 Revision/Generation 只有一个 Candidate 与 Checkpoint；旧 Lease/进程返回值不能覆盖持久化 Manifest；
- target ref 必须指向以 expected base 和 Candidate 为两个 parent 的真实 Merge Commit；Merge UNKNOWN 只接受 `ALREADY_APPLIED` 对账；
- Archive、Closure 和 Knowledge Disposition 各唯一；Board/Trace 的 outcome、archive 和 Role 数量与 Workflow Projection 一致；
- Harness 不扫描目录推进状态，不编辑 Projection，不删除历史，也不复用 Workflow key。

## 运行中发现并保留的失败历史

- `CoreV2Workflow/recovery-20260823123815-9822...`：首版 Harness 生成不符合领域正则的 Task ID，Invocation 在 TaskAuthority 前失败并依法通过 Restate cancel 终止；没有 Projection 或 key 复用。Finding：`core-v2-recovery-acceptance-generated-invalid-task-id`；
- `TASK-RCV-20260823132058-02-TEST-NOT-APPLIED`：Fixture 的 Agent 自测误触外部执行账本导致合法 Repair，后续真实 Final Review 又发现文档歧义，最终预算耗尽并完成 Failure Closure/Archive。它是保留的 `CLOSED / FAILED_TERMINAL / ARCHIVED` 历史，不算 NOT_APPLIED 通过证据；
- 前两次 business-complete 运行暴露 Service 子进程已经退出但 Harness 仍等待 event-loop handle 的清理缺陷。正式五场景摘要仍完整保留；修复后专用 cleanup smoke 以退出码 0 验证收尾路径，并显式禁止计入产品矩阵。

## 自动门禁

| 命令 | 结果 |
|---|---|
| `npm run acceptance:core-v2:recovery` | PASS（产品断言）：五个全新真实 Task 均 `CLOSED / SUCCEEDED / ARCHIVED`；Matrix `recovery-20260823142107-40380`。命令在摘要后因 Harness 清理缺陷由操作者中断，不能声称该次进程退出码 0 |
| `MOYE_CORE_V2_RECOVERY_CLEANUP_SMOKE=enabled npm run acceptance:core-v2:recovery` | PASS：退出码 0；零产品场景；Root `recovery-20260823145419-37023` |
| `npx vitest run tests/unit/core-v2-workflow.test.ts tests/e2e/core-v2-test-verification.test.ts` | PASS：2 files / 11 tests |
| `npm run check` | PASS：TypeScript；36 个单元测试文件 / 209 tests；Document Graph |
| `npm run test:e2e` | PASS：12 个真实 Restate E2E 文件 / 31 tests（以 `npx vitest run tests/e2e --reporter=dot` 复核退出码 0） |
| `ruby scripts/docs_graph.rb validate` | PASS：415 documents / 641 relations / 270 Markdown files |
| `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-23-TASK-0044/docs-impact.yaml` | PASS：31 required reads / 45 reviewed impacts |
