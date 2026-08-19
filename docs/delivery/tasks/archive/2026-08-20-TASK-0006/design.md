# TASK-0006 Design

> 状态：Approved
> Spec Revision：1

## 所有权与数据流

```text
TaskAuthority/<task_id> (单一 Workflow 主权声明)
  └─ CodingTaskWorkflow (编码状态唯一写入者)
  CONTEXT   → frozen Envelope
  WORKSPACE → Workspace Effect / Checkpoint
  IMPLEMENT → AgentRun Artifact → Result Commit Checkpoint
  VERIFY    → Command Evidence + verified commit binding
  MERGE     → stable local Merge Effect / Reconcile
  DOCS      → docs impact Artifact
  CLOSED    → immutable closure projection
  ARCHIVE   → independent ArchiveWorkflow / local receipt
```

Workflow 调用 Adapter 的方式是“输入冻结、输出验证、由 Workflow 记录事件”。六个领域 Step 都创建独立 Attempt，并把 Result 转成 Attempt Evidence 和 Binding 后进入 Projection。Adapter 没有 Projection 写入口。Restate 使用一个 durable epoch 派生确定时间，保证重放路径一致；ProjectBoard 只是 Coding Projection 的查询副本。

Verification 与真实 Codex 在执行前写稳定 Intent。已有完整 Outcome 时直接校验复用；只有 Intent 而没有 Outcome 表示副作用结果未知，自动执行被禁止并转为 `RESULT_UNKNOWN`，由新 Spec Revision/Attempt 或人工对账接管。

## Merge 边界

Merge Effect 绑定 Repository、Target Ref、Expected Base、Source Commit 和 Verification Digest。Target Ref 不得在任何 Worktree 中检出，避免 ref 更新后留下失配的 index/worktree；系统在隔离集成 Worktree 中创建确定性双亲 Merge Commit，再以 `git update-ref target candidate expectedBase` 做原子 CAS。并发推进 Target 只会令 CAS 失败，不可能先写入错误 Merge 再报告 Conflict。未知回执通过唯一 marker、双亲和 target ancestry 对账。
