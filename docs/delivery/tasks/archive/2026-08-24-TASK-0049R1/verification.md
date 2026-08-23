# TASK-0049R1 Verification

> 状态：Accepted
> 验证日期：2026-08-24

## 结论

CLI 已在 `seal-start` 的 `send()` 前复用 `createSealIntent`。无 Active package 的真实 CLI 子进程即使指向不可达 Restate 端口，也先返回 package 校验错误，证明没有发出 Runtime 请求；合法 TASK-0049R1 则一次提交后得到 Intent `sha256:0644d5a8f8c4dd56ffa7ad8a199444a36541161935464ca0ed27d2c831af9793`。Workflow 内的同源 durable 校验和最终 Result Commit Gate 均未移除。

`TASK-0049` 的 Invocation `inv_14WMLTdctFwz3TAplbgy2bCQyx00IWI42o` 保持 `completed / Output Failure`；`status`、`seal-status`、TaskAuthority 和 Board 均无业务 Task。没有复用 Workflow key、purge Invocation、直接写 Projection 或伪造归档。replacement `TASK-0049R1` 使用 Invocation `inv_1bYpHmRWTJYF0QKyRGuzlrVhJWVJL2N4qw`。

## Requirement → Test → Evidence

| Requirement | Test / Execution | Evidence |
|---|---|---|
| REQ-0049R1-01/02 | `tests/unit/cli-seal-preflight.test.ts` 启动真实 CLI 子进程，Restate 指向 `127.0.0.1:1` | package 缺失时 exit 1，stderr 命中 Task path 且不含 `fetch failed/ECONNREFUSED`；`npm run check` 中通过 |
| REQ-0049R1-01/07 | `seal-start TASK-0049R1` 一次真实 Restate 提交 | Invocation `inv_1bYp…2N4qw`；Projection `EXECUTING / waiting-result-commit`；Intent Digest `sha256:0644…9793` |
| REQ-0049R1-03 | Restate Admin Journal、CLI status、Board API 只读查询 | 原 Invocation index 3 为 `prepare-seal-intent`、index 4/5 为 Failure；`status TASK-0049=null`；Board HTTP 404 |
| REQ-0049R1-04/05 | TASK-0030～0048 owning Workflow/合法 successor 与 `/api/tasks/<id>/trace` 查询 | Roadmap 记录 23 个实际 Result Commit/Package Digest；既有 archived package 和 Projection 未修改 |
| REQ-0049R1-06 | `acceptance:core-v2:audit` 附着显式 Manifest，只读重审计 16 个既有 Task | `passed=true`、`findingCount=0`、report digest `sha256:e3562bb913dcd5a9c273ce97377e2d2fb15f46e09d65e9dd176cba13347396b9` |

## 自动门禁

- `npm run check`：通过；39 个 Test File、224 个 Test；Document Graph 469 documents / 708 relations；
- `npm run test:e2e`：通过；12 个 Test File、31 个 Test，真实 Restate 单 worker；
- `npm run acceptance:core-v2:audit -- --file .moye-runtime/acceptance/core-v2/matrix-final-20260824/audit-input.json --output .../completion-audit-task-0049r1.json`：通过；16 场景、0 Finding；
- `ruby scripts/docs_graph.rb validate`：通过；
- Docs Impact Gate：Result Commit 前对 Graph revision 98 和最终 changed paths 执行。

## 证据边界

本 Task 没有重新运行 16 个昂贵 Agent 场景；它用显式 Manifest 对已经存在的真实 Runtime Task 做实时只读重审计，不提交 Workflow、不重跑 Agent/Test/Commit/Merge。TASK-0048 的真实 Agent 产品验收结论保持不变。完整多 Daemon Lease/Fencing、远程 Git Provider/PR、鉴权、多租户、生产 Sandbox/密钥治理、跨节点 Artifact Store、生产 Metrics/Logs/告警/SLO 与长期 Knowledge 效果反馈仍未实现。

Result Commit SHA、Package Digest 和最终 `CLOSED + SUCCEEDED + ARCHIVED` Receipt 只能在本 Commit 产生后由 Runtime 写入，必须通过 `npm run cli -- status TASK-0049R1` 查询，不能回写本文件形成自引用。
