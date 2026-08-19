# TASK-0006 Design

> 状态：Approved
> Spec Revision：1

## 所有权与数据流

```text
CodingTaskWorkflow (唯一状态写入者)
  CONTEXT   → frozen Envelope
  WORKSPACE → Workspace Effect / Checkpoint
  IMPLEMENT → AgentRun Artifact → Result Commit Checkpoint
  VERIFY    → Command Evidence + verified commit binding
  MERGE     → stable local Merge Effect / Reconcile
  DOCS      → docs impact Artifact
  CLOSED    → immutable closure projection
  ARCHIVE   → fixture artifact finalization
```

Workflow 调用 Adapter 的方式是“输入冻结、输出验证、由 Workflow 记录事件”。Adapter 没有 Projection 写入口。Restate `ctx.run` 缓存确定性步骤；Git 和 Agent 仍需自身幂等/对账，因为进程可能在副作用完成后、Journal 确认前退出。

## Merge 边界

本地 Merge 默认使用 `--no-ff` 产生可审计 Merge Commit。Effect 绑定 Repository、Target Ref、Expected Base、Source Commit 和 Verification Digest。未知结果先查询 Target HEAD：若它是唯一匹配的 Merge Commit且双亲正确则收敛；否则 Conflict，不盲目再执行。
