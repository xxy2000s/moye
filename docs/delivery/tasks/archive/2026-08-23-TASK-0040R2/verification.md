# TASK-0040R2 Verification

> 状态：Accepted

## Requirement → Test → Evidence

| Requirement | Test / Execution | Evidence |
|---|---|---|
| REQ-0040R2-01/02 | `tests/e2e/restate-recovery.test.ts` real Restate chain | root Seal 失败 → `SealedTaskRecoveryWorkflow` 失败 → `SealRecoveryAttemptWorkflow/*-RECOVERY-1` 失败 → `*-RECOVERY-2` 成功；source service/key 由 parser 判别，Authority 只接受当前 chain head |
| REQ-0040R2-03 | predecessor shared status + Authority assertions | E2E 分别查询 root、第一层 recovery、Attempt 1，Projection 保持原失败；Board 只解析 Attempt 2 的最终 `ARCHIVED` |
| REQ-0040R2-04 | `npx vitest run tests/e2e/restate-recovery.test.ts` | 1 file / 9 tests，真实 Restate 容器、真实 Git 仓库、真实 detached historical Gate 全通过 |
| REQ-0040R2-05 | persistent Runtime acceptance | TASK-0040：Attempt 2 收敛；TASK-0040R1：Attempt 2 收敛；两者均 `CLOSED + SUCCEEDED + ARCHIVED`，Trace `VERIFIED` |
| REQ-0040R2-06 | two-phase Seal | Intent `sha256:d0b1fd84c34e5fc4c765e0073fad156fa2acd955965a6235eb8777f704bc3f10`、token `sha256:dd236c934062a3b4dfc7d6c6610c72aa0082ece23e7d4c82d965efec2cf2f5a9`；Result Commit 后由 Runtime Receipt 定终态 |

## 真实历史收敛

| Task | Authority chain head | Corrected Commit | Package Digest | Final |
|---|---|---|---|---|
| TASK-0040 | `SealRecoveryAttemptWorkflow/TASK-0040-RECOVERY-2` | `ac213a5a3bd4055debfdb01c139181727b5d5697` | `sha256:3e262702b81a6a1be913aa7da56247126e86b8feb03a2d457d0ebed33f90c1ce` | `CLOSED / SUCCEEDED / ARCHIVED`；16 Events |
| TASK-0040R1 | `SealRecoveryAttemptWorkflow/TASK-0040R1-RECOVERY-2` | `692981d763b8a00ffe380657610780d09f5f812f` | `sha256:95d8b2c72e65a66670784388bb3bb58d0f0bb7286885c3f91ae0f5478f86bdc2` | `CLOSED / SUCCEEDED / ARCHIVED`；16 Events |

两条 Trace 的 `workflow=SealRecoveryAttemptWorkflow`、`overall=ARCHIVED`、`consistency=VERIFIED`。原 Seal、第一层 recovery 和 numbered 失败 Attempt 均保留；没有 purge Invocation、复用 Workflow key、修改数据库或直接写 ProjectBoard Projection。

## 全库门禁

- `npm run check`：TypeScript 通过；34 unit files / 192 tests；文档图谱通过；
- `npm run test:e2e`：12 files / 30 tests，通过；
- `ruby scripts/docs_graph.rb validate` 与本 Task Docs Impact Gate 在最终 changed-path stage 后再次执行；
- Knowledge Disposition：`applied`，真实缺口进入 Finding、Backlog、Architecture、CodeMap、Runbook 与 Durable Runtime Pitfall #16。
