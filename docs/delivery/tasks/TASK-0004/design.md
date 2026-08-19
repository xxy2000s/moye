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
  └── canonical Effect ID
             │
             ▼
      inspect Git facts first
       ├── exact match → ALREADY_APPLIED
       ├── contradiction → CONFLICT
       └── absent → apply once → inspect again
```

Git 调用自身不能提供跨进程事务；因此“命令返回失败”不能直接等于“副作用没发生”。Adapter 在任何未知结果后重新读取 `git worktree list --porcelain`、Branch Ref 和 Worktree HEAD，仅用这些事实判定成功、冲突或可安全重试。

## Checkpoint

Checkpoint 不保存 dirty 工作区作为唯一事实。本切片只接受已提交 Commit，记录由 Git 解析出的完整 Commit 和 Tree Object ID，并验证 Base ancestry。后续 Agent Task 可以用 Commit 重建工作现场；本地 Worktree 只是缓存。
