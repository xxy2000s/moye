# TASK-0004 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）
> Runtime Closure：本文件是关闭前验收输入；实际 Commit、Invocation 与 Archive 由 Runtime Artifact 和 Projection 记录

## 验收映射

| Requirement | 证据 | 结果 |
| --- | --- | --- |
| REQ-0004-01 | 临时仓库测试覆盖仓库/文件系统根目录、Git common-dir/objects、Worktree Root/Target Symlink；所有 Runner Invocation 固定 `git` argv 与 `shell:false` | 通过 |
| REQ-0004-02 | Base Ref 漂移、预占 Task Branch 和未登记目标目录均收敛为 Conflict，未创建 Worktree | 通过 |
| REQ-0004-03 | 同一 Effect 重复调用只执行一次 `git worktree add`；完整 Effect 摘要进入 Branch ownership；新 Spec 不能认领旧 Workspace | 通过 |
| REQ-0004-04 | 故障 Runner 丢失确认后从 Worktree/Branch/HEAD 恢复；prunable metadata 或物理目录缺失收敛为 Conflict | 通过 |
| REQ-0004-05 | Checkpoint 拒绝 tracked dirty/untracked；固定 Result Commit、Git Tree Object ID 和 ancestry；篡改、伪造与 Branch 后移失败 | 通过 |

## 命令证据

- `npm run check`：通过；TypeScript、51/51 单元测试和 69 文档/121 关系图均通过。
- `npm run test:e2e`：通过；既有 3/3 真实 Restate 回归用例无退化。
- Docs Impact：通过；21 个 Required Read、8 个 Reviewed Impact。
- `git diff --check`：通过。

## Review

第一轮只读审查用真实临时仓库复现四个 major：Git metadata 可被选作目标、dirty/untracked 现场可被 Checkpoint 静默遗漏、不同 Spec Effect 会认领旧 Workspace、prunable metadata 会把丢失目录误判成功；同时发现 Base Ref 别名会破坏 Effect ID 规范性。实现补充 Git common-dir 禁区、Checkpoint clean gate、Effect Digest Branch ownership、prunable/物理目录检查与 `refs/heads/*` 约束。第二轮复核再次覆盖全部旧问题和“prunable 后普通目录占位”，未发现 blocker 或 major，同意进入 Result Commit。

## 当前限制

- Worktree 是单机执行缓存；Checkpoint Commit 才是可迁移事实，本 Task 不实现跨节点传输。
- 本 Task 不运行 Agent、不验证业务命令、不执行 Merge；这些边界由 TASK-0005 和 TASK-0006 消费。
- Effect Ledger 尚未接入 Workflow；当前 API 提供稳定 Effect ID 和事实对账语义，持久化所有权由后续 Workflow 实现。
