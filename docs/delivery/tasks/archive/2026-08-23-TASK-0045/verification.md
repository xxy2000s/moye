# TASK-0045 Verification

> 状态：Accepted
> 验证日期：2026-08-23

## 证据等级与范围

本 Task 使用真实 `CODEX_EXEC`、持久化 Restate、三个独立 Workflow key、三个隔离 Git 仓库、真实 Candidate/双父 Merge（仅成功场景）、真实 Trusted Runner、Role Session/Event/Manifest、Failure/Success Closure 和 Archive Receipt。预算 profile 只向真实 Agent 注入连续可观察缺陷，不替换 Role Runtime；Observer 场景实际启动 Codex 并由通用进程 Runner 在 1 秒超时后发送 SIGTERM。

正式产品证据根为 `.moye-runtime/acceptance/core-v2/guards-20260823152633-73982`，`matrix-summary.json` 标记 `validationKind=PRODUCT_ACCEPTANCE`。两个预算 Task 均 `CLOSED / FAILED_TERMINAL / ARCHIVED`，Observer timeout Task 为 `CLOSED / SUCCEEDED / ARCHIVED`。

本 Task 只证明单 owning Workflow 下基于持久化 Attempt/Manifest 的 Revision/Generation fencing。完整多 Daemon Lease、跨主机 fencing token 和远程 Git Provider 仍属于未实现生产能力。

## Requirement → Scenario → Execution → Evidence

| Requirement | 真实 Runtime Task | 关键执行与约束 | 最终 Evidence | 结果 |
|---|---|---|---|---|
| REQ-0045-01/05/07 | `TASK-GRD-20260823152633-01-REPAIR-BUDGET` | G0/G1 两次真实 Implementation 都产生 Blocking Self Review Finding；G1 后预算耗尽；没有 Documentation/Test/Final Review/Merge；两个 Candidate Commit 均保留 | G0 Candidate `f3e4d6d…50d9` / Checkpoint `sha256:67900b…cdec`；G1 Candidate `d8dfa0e…524c` / Checkpoint `sha256:b7ab46…bf71`；Knowledge `sha256:c9f429…1c33`；Failure Closure `sha256:c95075…aa63`；Archive `sha256:457eb8…4248`；Projection `sha256:9a6b33…f62f` | PASS：唯一失败归档，预算后无新 Agent/Test/Merge |
| REQ-0045-02/05/07 | `TASK-GRD-20260823152633-02-REPLAN-BUDGET` | R1/R2 各执行真实 Architect + Design Review；两轮都缺少 Trusted Runner 设计组件；R1 四项 Artifact 显式 invalidated；R2 后预算耗尽，没有 Implementation/Commit/Test/Merge | Knowledge `sha256:b4a584…346f`；Failure Closure `sha256:a224fd…abf4`；Archive `sha256:a8432e…77c4`；Projection `sha256:a10d19…a683` | PASS：旧 Revision 保留且失效，唯一失败归档 |
| REQ-0045-03/04/05/07 | `TASK-GRD-20260823152633-03-OBSERVER-TIMEOUT` | 七个主流程 Role、真实 `npm test`、Gate 均通过；随后真实 Observer Agent 在 1 秒超时，留下 Session/Event 和 `INVALID_OUTPUT` Manifest；Disposition=`deferred`；主流程继续真实 Merge/Closure/Archive | Candidate `ad7fc24…5120`；Tree `093cc2…5473`；Test `sha256:ec9bd0…0ffd`；Gate `sha256:278995…9024`；Merge `73e130b…5878`；Knowledge `sha256:a32377…2d78`；Closure `sha256:9f0b50…11b6`；Archive `sha256:653251…f3fa`；Observer Report `sha256:1596c7…ec7b` | PASS：旁路失败不阻塞，确定性 Observer 仍报告 8 Attempts / 1 failure |
| REQ-0045-06 | Repair/Replan 两个失败 Task | 对实际 G0 Implementation Manifest 和 R1 Design Review Manifest 调用 owning Workflow `auditAttemptFence`；错误 Digest 409；正确值分别 `STALE_GENERATION` / `STALE_REVISION`；相同请求重放完全相同；前后 Lifecycle Projection Digest、Closure Digest 不变 | Repair stale Manifest `sha256:be62e8…38d3`；Fence report `sha256:e42155…c7cf`；Replan stale Manifest `sha256:23a92f…a8f7`；Fence report `sha256:c6f556…b8ea` | PASS：旧 Evidence 没有状态写入口，不能覆盖 Candidate/Closure/Archive |
| REQ-0045-08 | `npm run acceptance:core-v2:guards` | 一次命令依次创建三个新 Task，强断言 Attempt/Run/Session 唯一、预算边界、副作用数量、fencing 幂等、Observer 非阻塞和 Board Trace | `matrix-summary.json`、逐场景 `task-input.json`、`submission-receipt.json`、`final-projection.json`、`final-trace.json`、`evidence-summary.json`、Role/Test Artifact | PASS |

## Role Attempt / Session 索引

| Task / Phase | Session ID | Manifest Digest |
|---|---|---|
| Repair Architect | `01a02f3b-17a8-7251-948b-0db689ef13b2` | `sha256:a90f4a…7b4a` |
| Repair Design Review | `01a02f3b-dbda-7710-95b2-0344e84c04f7` | `sha256:8a0e87…eee4` |
| Repair Implementation G0 | `01a02f3c-2af4-77d3-8bce-67bc96fa08c3` | `sha256:be62e8…38d3` |
| Repair Implementation G1 | `01a02f3f-1501-7d00-9d63-46d9e05b8a33` | `sha256:26e9e0…e05f` |
| Replan Architect R1 | `01a02f40-1fbe-78a3-abd8-627bf76207ef` | `sha256:70a4ed…20c0` |
| Replan Design Review R1 | `01a02f41-12a1-7da2-84da-a5bac4203fff` | `sha256:23a92f…a8f7` |
| Replan Architect R2 | `01a02f41-7d04-7352-b546-73e9dd05ea82` | `sha256:739f89…62e5` |
| Replan Design Review R2 | `01a02f42-71ee-7e11-b76e-1dd7e34de09a` | `sha256:f70076…7b09` |
| Observer Task Architect | `01a02f42-cd44-73d1-bd7f-a90c8de0d897` | `sha256:357a1d…8b98` |
| Observer Task Design Review | `01a02f43-8885-7d73-bf32-a05445c78d7d` | `sha256:b7348c…fac4` |
| Observer Task Implementation | `01a02f43-e1bd-7c10-8c05-965484e7cde2` | `sha256:dd936e…14f0` |
| Observer Task Documentation | `01a02f44-b7c0-7a02-8e2e-38381069e091` | `sha256:73c257…4e06` |
| Observer Task Test Plan | `01a02f45-c11c-7702-aa34-c5bebc61626f` | `sha256:435a0c…3b3a` |
| Observer Task Test Assessment | `01a02f46-09cd-7df0-9afb-2a0a9d9c9e4c` | `sha256:92983f…6ad8` |
| Observer Task Final Review | `01a02f46-42dc-75c3-a034-12ab6cb6dbd2` | `sha256:0406df…51c8` |
| Observer/Knowledge timeout | `01a02f47-9007-7570-b40e-feed7f23f2f4` | `sha256:c0b916…5f38` |

完整 Attempt ID、Run ID、Events Digest 与原始 Event 引用位于各 `evidence-summary.json` 和 `final-trace.json`。Observer timeout 仍取得真实 Session 和 Event，Attempt 终态为 `FAILED`；它没有被伪装成成功 Agent Run。

## 唯一性与状态机审计

- Repair Task 只有 4 个 Role Run、2 个 Candidate、0 个 Trusted Test、0 个 Merge；Failure Artifact 保留原阶段 `REPAIR_REQUIRED`、4 个 Attempt/Session；
- Replan Task 只有 4 个 Role Run、0 个 Candidate/Test/Merge；R1 在 `invalidatedRevisions`，R2 的失败 Review 保留在当前失败 Revision；
- Observer Task 有 8 个唯一 Attempt/Run/Session、1 次 Trusted Test、1 个 Candidate、1 个双父 Merge、1 个 Success Closure 和 1 个 Archive Receipt；
- `auditAttemptFence` 只定位 Workflow 自身持久化 Evidence，不接受外部结果，不调用 Lifecycle Reducer，不发布 Board Projection；
- 智能 Observer 只提出候选或 defer，不接受 ADR 写入能力；本次 `deferred` candidate 仍只是 `knowledge-candidate://`，不是 Accepted ADR；
- 三个 Task 的 Board Trace 与 Workflow Projection 在 outcome、archive、Attempt/Session 和确定性 Observer 事实上一致。

## 自动门禁

| 命令 | 结果 |
|---|---|
| `npm run acceptance:core-v2:guards` | PASS：3 个全新真实 Task；Matrix `guards-20260823152633-73982` |
| `npx vitest run tests/unit/core-v2-workflow.test.ts tests/unit/core-v2-observer.test.ts tests/unit/role-runtime-v2.test.ts` | PASS：3 files / 19 tests |
| `npm run check` | PASS：TypeScript；36 个单元测试文件 / 210 tests；Document Graph |
| `npm run test:e2e` | PASS：12 个真实 Restate E2E 文件 / 31 tests，退出码 0 |
| `ruby scripts/docs_graph.rb validate` | PASS：422 documents / 650 relations / 275 Markdown files |
| `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-23-TASK-0045/docs-impact.yaml` | PASS：28 required reads / 47 reviewed impacts |
