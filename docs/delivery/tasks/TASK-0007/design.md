# TASK-0007 Design

> 状态：Approved
> Spec Revision：1

## 查询边界

```text
TaskAuthority/<task_id> ──owner──> CodingTaskWorkflow/<task_id>
                                      │ status (read-only)
                                      ▼
                              Coding Trace Builder
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              Business facts   Durable runtime   Logs / artifacts
                    └─────────────────┼─────────────────┘
                                      ▼
                              Board API + Trace UI
```

Trace Builder 是纯函数，只从 Coding Projection 派生查询模型。它不推进状态、不执行副作用、不保存独立恢复状态。TaskAuthority 暴露只读 owner 查询，让 Board 选择正确主 Workflow；未知或非 Coding Task 仍使用已有通用 Task 详情。

## 恢复语义

恢复建议由业务终态、当前 Step/Attempt、Verification、Merge 和 Archive 状态共同决定。运行中或副作用结果未知时建议等待 Restate 重放或先 Reconcile；验证/Agent 的确定性失败保持终态并要求新 Task/Spec Revision；仅归档失败时只重试 Archive。真实执行顺序仍由 Workflow 和 Journal 决定。

## 故障注入

Agent 非零退出和验证失败走确定性失败路径；重复调用同一 Workflow key 验证 Restate 幂等结果；Service 在 Verification 后被强杀验证 Journal 接管；Git ref 原子更新完成后立即退出进程，重启后由 Merge Effect 对账并复用同一 Commit。
