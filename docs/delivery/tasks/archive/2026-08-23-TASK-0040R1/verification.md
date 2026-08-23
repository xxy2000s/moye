# TASK-0040R1 Verification

> 状态：Accepted

Result Commit 后的业务终态以 Runtime Receipt 为准。

## Requirement → Test → Evidence

| Requirement | Test | Evidence |
|---|---|---|
| REQ-0040R1-01 | 查询原 Workflow | `SealedTaskWorkflow/TASK-0040` Event 1～6 保留 rejected Commit `9c68901e89e3fe378dbc5c84396eee2d005b19fe`、`FAILED_TERMINAL` 与 `ArchiveFailed`；错误为 `Docs Impact does not cover changed paths: docs/delivery/tasks/archive/README.md` |
| REQ-0040R1-02 | changed-path 对账与 Docs Impact Gate | TASK-0040 报告补入 `docs/delivery/tasks/archive/README.md`；TASK-0040R1 报告覆盖从 base `9c68901…` 到当前冻结树的全部路径 |
| REQ-0040R1-03 | 两阶段 Seal Intent | `SealedTaskWorkflow/TASK-0040R1` 已冻结 Intent `sha256:954c7888aad357f8f78ace60f8326865d7a2749f4615558a95bce522c6645ae9` 和 token `sha256:6efbc531ff89abdd91073b9338831e482a83fd35debdb83b79d208b7662a8b9c`；原 TASK-0040 token 为 `sha256:f899c03b08ac58dd33c006be166ff5461a599e56d71b43532d33ef6b585d5a9c` |
| REQ-0040R1-04 | append-only recovery successor | Result Commit 后仅通过 `core-v2` Runtime CLI 的 `recover-sealed-failure` 提交 corrected Evidence；验收读取 Authority、source Workflow 与 successor，禁止写 Projection |
| REQ-0040R1-05 | 独立 Result Commit Seal | TASK-0040R1 使用自己的 Workflow key、Intent 和 Evidence；Result Commit 生成后提交 `seal-complete`，Receipt 为业务终态权威 |

## 冻结前门禁

- `ruby scripts/docs_graph.rb validate`：通过，356 documents / 568 relations / 228 Markdown；
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-23-TASK-0040R1/docs-impact.yaml`：通过，23 required reads / 28 reviewed impacts；最终 stage 后再次执行；
- `npm run check`：通过，TypeScript 无错误、34 unit files / 192 tests、文档图谱有效；
- 原 TASK-0040 的失败 Workflow、Event 和 rejected Evidence 不做删除、amend 或覆盖。

## Seal 后核对

Seal 后必须同时查询：TASK-0040 默认 Authority、`SealedTaskWorkflow/TASK-0040` 原失败投影、`SealedTaskRecoveryWorkflow/TASK-0040` successor，以及 `SealedTaskWorkflow/TASK-0040R1`。只有 successor 与 R1 都为 `SUCCEEDED + ARCHIVED` 才完成恢复；这些 Receipt 不回写到产生它们的 Result Commit，以避免自引用。
