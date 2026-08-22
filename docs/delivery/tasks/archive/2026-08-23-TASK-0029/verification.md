# TASK-0029 Verification

> 状态：Accepted

## Requirement → Test → Evidence

| Requirement | Test | Evidence |
|---|---|---|
| REQ-0029-01 | Bootstrap Preflight unit + 真实 Restate 绕过 CLI 调用 | 无效基线返回 `BOOTSTRAP_BASE_COMMIT_NOT_FROZEN`；Authority、TaskWorkflow status 和 Board 均无记录 |
| REQ-0029-02 | 真实 Restate post-dispatch Evidence failure + 重复 status | 唯一 `TaskClosed`，最终 `FAILED_TERMINAL + ARCHIVED`；重复查询返回同一 Projection |
| REQ-0029-03 | 旧版 Service 先制造 completed/failure，再部署新版 successor；真实 TASK-0028 recovery | E2E 保留旧 Projection并追加一次 successor；TASK-0028 Runtime sequence 3～6 完成 Recovery/Close/Archive |
| REQ-0029-04 | `npm run check`、`npm run test:e2e`、Docs Impact Gate | 28 个单测文件/159 tests；5 个 E2E 文件/17 tests；Graph 266 documents/441 relations；Impact 45 reads/28 reviews |

## 实际命令

```text
npm run check
npx vitest run tests/e2e/restate-recovery.test.ts
npm run test:e2e
ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0029/docs-impact.yaml
```

## TASK-0028 真实恢复证据

- Source Workflow：`restate://TaskWorkflow/TASK-0028`；
- Source Invocation：`inv_11E8Qgaf5P8C7sJatlpDb7inf2nwlhoknv`，保持 `completed/failure`；
- Successor：`restate://BootstrapFailureRecoveryWorkflow/TASK-0028`；
- Error：`BOOTSTRAP_BASE_COMMIT_NOT_FROZEN / CONFLICT`；
- Runtime 终态：`CLOSED / FAILED_TERMINAL / ARCHIVED`；
- Archive：`docs/delivery/tasks/archive/2026-08-23-TASK-0028/`；
- Board API：`GET /api/tasks/TASK-0028` 返回 successor Projection，Trace 同时给出 recovery 与 source ref。

## Knowledge Disposition

`applied`：把“不可变 Bootstrap 基线晚校验会造成 Invocation Failure 与业务 Projection 分离”提升为 Durable Runtime Pitfall #14，并更新 Architecture、CodeMap 和 Runbook。

## 剩余风险

- Restate 1.7.4 Workflow 的已失败 run 不能 restart-as-new；successor 只作为升级前已知 Bootstrap 故障的兼容路径，不是通用恢复 API；
- Runtime Closure/Archive 产生的 Git 工作树变化与“一个 Task 一个 Result Commit”的无循环协议由 TASK-0030 正式解决，本 Task 没有弱化现有证据门禁。
