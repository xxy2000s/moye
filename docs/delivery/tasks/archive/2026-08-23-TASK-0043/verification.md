# TASK-0043 Verification

> 状态：Accepted
> 验证日期：2026-08-23

## 证据等级与范围

本 Task 的产品验收使用真实 `CODEX_EXEC`、持久化 Restate、独立 Git 仓库、真实 Candidate/双父 Merge Commit、真实 `npm test`、Role Session/Event、内容寻址 Artifact、Closure 和 Archive Receipt。`acceptanceControl` 只在显式授权的验收 Service 中向指定 Phase 的真实 Agent Prompt 注入条件；没有替换 Agent、Runner、Git、Workflow、Gate 或 Projection。

本 Task 只接受 Happy、Implementation Self Review Finding、Final Review Finding、Documentation Finding、Test Failure 和 Design Replan 六类场景。Test UNKNOWN、Worker kill、Git 回执未知、预算耗尽、Observer/Knowledge 故障和 stale Attempt 仍由 TASK-0044/0045 验收，因此本结果不代表 Core v2 完整故障矩阵完成。

## Requirement → Scenario → Execution → Evidence

| Requirement | 真实 Runtime Task | 关键执行与约束 | 最终 Evidence | 结果 |
|---|---|---|---|---|
| REQ-0043-01/02/07/08 | `TASK-ACCEPT-20260823101751-01-HAPPY` | 7 个真实 Role Session；1 个 Candidate；1 次 `npm test`；1 个真实双父 Merge | Candidate `02b2f0d…ae8d`；Merge `0eba164…9403`；Test Manifest `sha256:042d7a…c5e8`；Gate `sha256:699323…575a9`；Closure `sha256:b37fd2…ef9fd`；Archive `sha256:c0cc60…21566` | PASS：`CLOSED / SUCCEEDED / ARCHIVED` |
| REQ-0043-03/07/08 | `TASK-ACCEPT-20260823114251-01-IMPLEMENTATION-SELF-REVIEW` | G0 Self Review 产生稳定 Finding；G1 修复；仅 G1 执行 Documentation/Test/Final Review | 8 个 Session；Candidate `d809761…844d`；Merge `13c3d7e…0685`；Test `sha256:9b4746…38da`；Gate `sha256:579487…96b50`；Closure `sha256:962586…dcc9a`；Archive `sha256:a2ba0a…2e318` | PASS：G0 终结并失效，G1 唯一成功 |
| REQ-0043-04/07/08 | `TASK-ACCEPT-20260823114251-02-FINAL-REVIEW` | G0 真实测试通过后 Final Review Blocking Finding；G1 重新 Implementation/Documentation/Test/Final Review；旧 Review 不进入新 Gate | 12 个 Session；Candidate `5db0e28…fbee0`；Merge `21e6a7e…76a2`；Test `sha256:354e1b…e3de` / `sha256:50fc08…a732`；Gate `sha256:337156…6a086`；Closure `sha256:dadfea…6ea75`；Archive `sha256:cf8f22…43076` | PASS：两代 Candidate 与 Review 均可追踪 |
| REQ-0043-05/07/08 | `TASK-ACCEPT-20260823114251-03-DOCUMENTATION` | G0 Documentation Finding；G1 修复后重新执行 Documentation、Test、Assessment、Final Review；Docs Gate 未绕过 | 9 个 Session；Candidate `44b1161…9ddf`；Merge `3f2a02e…58f5`；Test `sha256:a47132…1b2c`；Gate `sha256:ff1623…9113e`；Closure `sha256:fa7bcb…1c56e`；Archive `sha256:68769e…60f90` | PASS：旧文档 Evidence 显式失效 |
| REQ-0043-05/07/08 | `TASK-ACCEPT-20260823114251-04-TEST-FAILURE` | G0 真实 `npm test` 退出 17，Test Assessment 形成 Finding；G1 修复后测试退出 0；两次执行分别绑定两个 Candidate | 11 个 Session；G0 Test `sha256:752993…e3fe1`；G1 Test `sha256:a52d14…ed7c3`；Candidate `bc347bc…9adc`；Merge `b17cb0a…0a7d`；Gate `sha256:4e7ef1…78fd1`；Closure `sha256:db9bbd…445d3`；Archive `sha256:f62b6d…011a3` | PASS：失败测试保留但不进入最终 Gate |
| REQ-0043-06/07/08 | `TASK-ACCEPT-20260823114251-05-DESIGN-REPLAN` | R1 Architect/Design Review 形成 REPLAN；R1 四个 Artifact 显式 invalidated；R2 重新 Architect/Design Review，只有 R2 进入实现与 Gate | 9 个 Session；Candidate `75fdd22…3ae87`；Merge `3c7533d…20a0`；Test `sha256:e1bea1…e0ad8`；Gate `sha256:eded3a…da512`；Closure `sha256:c781ed…42536`；Archive `sha256:81dfc0…d2b2c` | PASS：`specRevision=2`，R1 Evidence 不可跨代复用 |

完整逐 Role `Attempt ID / Session ID / Run ID / Events Digest / Manifest Digest`、Checkpoint Tree、测试 argv/stdout/stderr/exit code、Projection 和 Trace 摘要保存在各场景的 `evidence-summary.json`、`final-projection.json` 与 `final-trace.json`。证据根目录为 `.moye-runtime/acceptance/core-v2/`，由运行入口每次创建不可复用的新 Task key 和独立 Git Fixture。

最终未筛选故障矩阵运行根为 `.moye-runtime/acceptance/core-v2/faults-20260823114251-64463`；`matrix-summary.json` 同时保存上述五个 Task 的全部 Session ID、Events/Manifest Digest、Projection Digest 和页面链接。

## 运行中发现并保留的失败历史

- `TASK-ACCEPT-20260823102846-02-FINAL-REVIEW`：旧 Design Review Prompt 越过阶段边界，耗尽 Replan 后合法完成 Failure Closure/Archive；不是 Final Review 场景通过证据；
- `TASK-ACCEPT-20260823104209-04-TEST-FAILURE`：Documentation Agent 提前消费 Test Gate，最终成功但不计入 Test Failure 验收；
- `TASK-ACCEPT-20260823111330-01-TEST-FAILURE`：真实失败测试后的 Assessment 缺少 `findingRefs`，合法完成 Failure Closure/Archive；不是通过证据；
- 上述历史均未删除、覆盖或重新提交相同 Workflow key，并推动了本 Task 的 Finding、修复和新 Task 重跑。
- 第一次未筛选 `acceptance:core-v2:faults` 在提交 Workflow 前暴露默认场景选择校验缺陷；没有制造 Runtime 历史，修复后同一未筛选命令完成上述 5/5 场景。

## 唯一性审计

- Harness 对每场景按 Revision/Generation/Phase 审计 Role Run、Attempt 和 Session 数量；
- `trustedTestRuns` 是 append-only 执行账本，`invalidatedGenerations` 保留旧 Candidate、Checkpoint、Artifact 和 Test Manifest；
- 最终 Verification Gate 只绑定活动 Revision/Generation 的 Candidate 与 Evidence；
- Git DAG 审计每个 Candidate Checkpoint 和唯一 Merge，目标 ref 必须指向真实双父 Merge Commit；
- Board Trace 与 Workflow Projection 的状态、Outcome、Archive、Role Run 和 Event 数量一致；
- Harness 不读取目录来推进状态，也不写 Runtime Projection。

## 自动门禁

| 命令 | 结果 |
|---|---|
| `npm run acceptance:core-v2` | PASS：真实 Happy Path |
| `npm run acceptance:core-v2:faults` | PASS：未设置场景过滤器，5/5 全新真实 Task 全部 `CLOSED / SUCCEEDED / ARCHIVED`；Matrix `faults-20260823114251-64463` |
| `npm run check` | PASS：TypeScript；36 个单元测试文件 / 208 tests；Document Graph |
| `npm run test:e2e` | PASS：12 个真实 Restate E2E 文件 / 31 tests |
| `ruby scripts/docs_graph.rb validate` | PASS：406 documents / 630 relations / 263 Markdown files |
| `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0043/docs-impact.yaml` | PASS：34 required reads / 46 reviewed impacts |
