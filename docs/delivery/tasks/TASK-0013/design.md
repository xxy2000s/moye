# TASK-0013 Design

## 设计结论

新增纯领域模块 `src/domain/core-control.ts`。它不调用 Restate、Agent、Git 或文件系统，只定义未来 `CoreClosureWorkflow` 唯一使用的控制协议和 Reducer：

```text
TaskEnvelope + CoreProjection + persisted refs
                │
                ▼
      Deterministic Orchestrator
                │ candidate ControlDecision
                ▼
       applyControlDecision (Reducer)
                │ validated transition
                ▼
       CoreProjection version N+1
```

## Projection 与阶段

- `CoreProjection` 固定 Task/Spec/Envelope Digest、Projection Version、Control State、Stage、Budget、Applied Decision 和 Pending Role Dispatch；
- 初始阶段为 `DOCS_REQUIRED`，只允许 `SCHEDULE_ROLE/DOCS`；
- Slice 1 只建立首个合法派发与可重放边界，不伪造 Role 完成；后续 Role Task 通过新的领域事件完成 Dispatch 并继续推进阶段；
- `appliedDecisions` 是控制事实摘要，不存储 Orchestrator 隐藏推理。

## 幂等与冲突

Reducer 先按 `decisionId` 检查历史：

1. ID 与 Digest 均相同：返回原 Projection；
2. ID 相同但 Digest 不同：冲突；
3. 新 ID：再校验 Expected State/Version、Task/Spec、预算和转换条件。

这个顺序保证调用方丢失确认后使用相同 Decision 重放时不会因为 Projection Version 已增加而被误判为新操作，也不会重复派发 Role。

## Digest

所有 Digest 使用字段顺序固定的 Canonical JSON 和 SHA-256。数组保持业务顺序；引用输入在边界去空白、去重并排序，避免等价集合产生不同 Decision。

## 后续接入

- Slice 2 将 Pending Role Dispatch 转为统一 Role Attempt/Run；
- Slice 3 引入 ReviewResult/Finding；
- Slice 4 扩展 `RETRY/REPAIR/REPLAN` 和中央预算消费；
- Slice 5 接入 Observer、Docs Impact 与知识候选；
- Slice 6 用 keyed Restate Workflow 驱动完整 Closure 和故障矩阵。
