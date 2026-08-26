# TASK-0078 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0078-01/02 | Git diff 与严格 Backlog loader | 只有 BL-0004/0005/0006/0007/0083 升级 v2；BL-0031 及其他 78 份文档未改；BL-0006/7 分别陈述已完成 Core 子集与开放生产缺口 |
| REQ-0078-03A | `loadBacklogSyncBatch(..., selectedIds)` + CLI `--id` | 非法、重复、缺失 ID 在 Runtime 前拒绝；selected source path 保持 canonical；unit 14/14 通过 |
| REQ-0078-03/04 | canonical `50889/50890` 正式 subset sync | Batch `98457bb9…b955`：received 6、inserted 1、updated 5；BL-0083 出现，BL-0031 按 v1 `CONVERTED_TO_TASK/TASK-0029` 从可见列表消失 |
| REQ-0078-05 | 完全相同命令正式重放 | inserted 0、updated 0、unchanged 6、changed false |
| REQ-0078-06 | Board/Runtime/Source Digest 交叉核对 | 五个可见条目均 schema v2，problem/affected/acceptance/source 完整；Receipt Digest `sha256:7240ec22f1c4b19c4a8b57a0ad0bfaf797a3cf7a44bca1a4e2bd5bd3aeadf4d5` |
| REQ-0078-06 | `npm run check`、Docs Graph/Impact、`git diff --check` | TypeScript、unit、Graph 与 Impact Gate 通过；见 Result Commit 前最终命令输出 |

## Runtime evidence

- Service/Board 平滑替换到 PID 15276，继续监听 `55923/3000`；Restate/Artifact 数据未停止或删除。旧 PID 对 SIGTERM 未退出，等待 10 秒确认后对精确 stateless Service PID 使用 SIGKILL；Workflow 状态仍由 Restate 持久化。
- canonical Deployment `dp_15LdVILkyN3PqLXlnroI77P`，Board `/readyz` 为 ready。
- 完整前后状态、六个 source digest、preserved IDs 与两次 Sync Result 见 [backlog-sync-receipt.json](./backlog-sync-receipt.json)。

## Boundary

- 同步 batch 只含 BL-0004/5/6/7/31/83；其他 26 个已有 Runtime Backlog 全部列入 `preservedIds`，未提交目录中其余历史文档。
- 没有直接 Projection mutation，没有复制文档改变 ownership，没有修改历史 completed Backlog 文件。
