# TASK-0016 Design

## 控制语义

继续使用唯一 `applyControlDecision` Reducer，不建立第二套恢复状态机：

```text
明确 Role Failure ── RETRY(role) ──> Pending Generation N+1
明确 Operation 未发生 ─ RETRY(operation) ─> 同一 Attempt / Operation
Blocking Review Gate ── REPAIR ───> Implementation Generation N+1
Design/Requirement 失效 ─ REPLAN ──> Spec Revision N+1 / Docs Generation 1
UNKNOWN ── WAIT ──> WAITING_RECONCILE ── confirmed/not-applied ──> RUNNING
budget exhausted ── CLOSE candidate ──> CLOSING / FAILED_TERMINAL candidate
```

## 持久化事实

Core Projection 增加 Role Failure、Recovery Action、Reconcile、Review Gate History、Evidence Invalidation 和 Terminal Candidate 摘要。所有摘要带 Digest 或稳定 Decision ID，重放先对账再决定是否推进 Projection Version。

## Replan

Replan 是唯一允许改变 Projection Spec Revision/Envelope Digest 的动作。Reducer 同时接收并重新验证新 TaskEnvelope；要求 Task ID 相同、Revision恰好 N+1，Decision Evidence 精确包含新 Envelope Ref。旧完成 Role Result 与 Gate Digest 被列入 Invalidation，不删除旧记录。

## 预算

- Operation Retry：`operationRetries=1`；
- Role Attempt Retry：`roleAttempts=1, modelCalls≤1`；
- Repair：`repairs=1, roleAttempts=1, modelCalls≤1`；
- Replan：`replans=1, roleAttempts=1, modelCalls≤1`；
- WAIT/CLOSE：零预算。

预算先完整校验再应用。Slice 6 消费 `FAILED_TERMINAL` Candidate 并生成最终 ClosureResult。
