# TASK-0077 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0077-01/03 | v2 Parser 与 Projection 单元测试 | `problem.observed/expected/impact/evidenceRefs`、`affectedAreas`、`acceptanceOutline` 与 `schemaVersion=2` 进入 Projection；缺项和 problem 未知字段拒绝 |
| REQ-0077-02 | v1 fixture 与仓库真实 v1 Backlog load/sync | v1 生成 `schemaVersion=1` 且不补造 problem；真实 Restate 批次可同步全部旧文档 |
| REQ-0077-04 | Runtime `upsertBacklog` 领域门禁 | v1 Runtime 输入与空 observed 拒绝；完整 v2 Runtime Backlog 接受 |
| REQ-0077-05 | Unit + 真实 Restate `backlog-sync` E2E | 相同 source digest 第二次 `unchanged`；重复 ID、伪造 batchId、文档/Runtime 双向所有权冲突拒绝；源消失 `PRESERVE` |
| REQ-0077-06 | `npx vitest run tests/e2e/backlog-sync.test.ts --maxWorkers=1 --no-file-parallelism` | 1/1 真实 Restate E2E 通过；隔离容器已自动移除 |
| REQ-0077-06 | `npm run check`、Docs Graph/Impact、`git diff --check` | TypeScript、全部 unit、文档图谱与 Impact Gate 通过；见 Result Commit 前最终命令输出 |

## Runtime incident and containment

- 首次 Seal 因默认端点误投旧 Runtime；没有直接写 Projection、删除 Invocation/Deployment 或删除数据卷。
- canonical 与旧 Runtime 的 Intent Digest 均为 `sha256:f258cffffc6a5b4c9a5e887b233ae02d7cc8a3991fbea560d9d31ea6040db391`，Token 均为 `sha256:06e650ebe9f2581efcf40c260b87526ce0f69fc8043dfbc01a1a20c04b4808cc`；同一个 Result Commit 可合法提交到两边。
- canonical 清理后保留 108 archived、5 backlog 与 TASK-0077 `waiting-result-commit`；旧 Runtime 停止但保留 `moye_restate_data` 卷和 TASK-0077 Journal。
- 14 个无活动 Invocation 引用的 Service/恢复实验进程以 SIGTERM 正常退出；保留 canonical `55923/3000` 和 3 个 paused Invocation 引用的 `9136/3014`。

## Boundary

- 本 Task 没有升级 BL-0004/0005/0006/0007/0083，也没有执行正式 Backlog Sync；它们属于 TASK-0078。
- 没有迁移历史 v1 Backlog、没有修改业务 Workflow 状态机、没有从 Git 文件补画 Board Projection。
