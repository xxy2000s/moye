# TASK-0004 Spec：Worktree、Checkpoint 与本地 Git Effect

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0002

## 目标

提供不依赖 Agent 或 Workflow 的本地 Git 执行边界：从冻结的 Base 创建隔离 Worktree，使用稳定 Effect ID 表示外部写操作，并通过 Git 事实在超时或进程中断后 Reconcile；Checkpoint 固定 Commit 与 tree digest，使执行现场不依赖旧进程内存。

## Requirements

### REQ-0004-01：隔离且安全的 Worktree

- Worktree 只能位于配置的 Worktree Root 内，目标路径由 `task_id` 确定派生；
- Repository Root、Worktree Root 与已有路径通过真实路径和父级约束校验，拒绝 `..`、绝对片段、符号链接逃逸和仓库内危险目标；
- Git 进程只接受 argv，执行时显式固定 `shell: false`。

### REQ-0004-02：冻结 Base 与 Branch

- Workspace Effect 固定 Task ID、Spec Revision、完整 Base SHA、任务分支和目标路径；
- 创建前验证 Base 对象存在，并验证声明的 Base Ref 仍指向该 SHA；漂移时停止而不是静默换 Base；
- Branch 或 Worktree 已被其他提交、路径或 Task 占用时返回显式 Conflict。

### REQ-0004-03：稳定 Effect ID 与幂等创建

- 规范请求产生确定性的 Effect ID，同一请求重复执行不创建第二个 Worktree；
- Effect 结果区分 `APPLIED`、`ALREADY_APPLIED` 和 `CONFLICT`；
- 不依赖调用者提供或对象自报 Effect ID，反序列化时以外部 Expected Effect ID 校验。

### REQ-0004-04：未知结果 Reconcile

- Git 命令返回未知结果或调用进程中断后，先检查 Worktree List、Branch Ref 与 HEAD；
- 外部事实完全匹配时收敛为 `ALREADY_APPLIED`，不重复写；
- 部分匹配或互相矛盾时返回 Conflict，只有确认未发生时才允许重新执行。

### REQ-0004-05：Checkpoint 与 Result Commit

- Checkpoint 固定 Task、Spec Revision、Effect ID、Base、Branch、Commit、tree digest 与创建时间；
- Commit 必须存在、属于 Task Branch 且 Base 是其祖先；tree digest 必须由 Git 重新计算；
- 序列化 Checkpoint 通过 Canonical Digest 和外部 Expected Digest 重建，篡改字段必须失败。

## 非目标

- 不调用真实或 Fake Agent；
- 不执行 Verification Gate；
- 不合并回目标分支，也不接入远程 Git Provider；
- 不实现 Lease、Fencing、Budget、Repair 或 Replan；
- 不把 Worktree 路径当作可迁移持久状态。

## 完成定义

临时 Git 仓库测试覆盖路径逃逸、重复创建、Base 漂移、Branch/路径冲突、未知结果 Reconcile、Checkpoint ancestry/tree digest 与序列化篡改；TypeScript、既有 E2E 和文档门禁通过。
