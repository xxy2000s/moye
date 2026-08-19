# TASK-0004 Design

> 状态：Approved
> Spec Revision：1

## 边界

新增独立 `src/git/` Adapter。领域输入来自冻结的 TaskEnvelope，但 Git Adapter 不推进 Task 主状态，也不调用 Agent。所有 Git 调用通过参数数组执行，并在写操作前后读取 Git 事实。

## Effect 与 Reconcile

```text
WorkspaceEffectRequest
  ├── repository root / managed worktree root
  ├── task + spec + base + base ref + branch
  └── canonical Effect ID → encoded into task branch
             │
             ▼
      inspect Git facts first
       ├── exact match → ALREADY_APPLIED
       ├── contradiction → CONFLICT
       └── absent → apply once → inspect again
```

Git 调用自身不能提供跨进程事务；因此“命令返回失败”不能直接等于“副作用没发生”。Adapter 在任何未知结果后重新读取 `git worktree list --porcelain`、Branch Ref 和 Worktree HEAD，仅用这些事实判定成功、冲突或可安全重试。Branch 名编码完整 Effect 摘要；相同 Task 的另一 Spec 或 Base 不能把旧 Workspace 冒认为自己的副作用。`prunable` 或物理目录丢失属于冲突，不能作为已完成或安全缺失处理。

Git common directory 由 `git rev-parse --git-common-dir` 解析并固定进请求；Managed Root 和目标不得位于该目录或其子树。Base Ref 只接受完整 `refs/heads/*` 名称，避免 `HEAD`、短分支名等别名产生多个 Effect ID。

## Checkpoint

Checkpoint 不保存 dirty 工作区作为唯一事实。本切片只接受 `git status --porcelain=v2 --untracked-files=all` 为空的已提交 Commit，记录由 Git 解析出的完整 Commit 和 Tree Object ID，并验证 Base ancestry。Tracked dirty 或 untracked 文件都会阻止 Checkpoint。后续 Agent Task 可以用 Commit 重建工作现场；本地 Worktree 只是缓存。
