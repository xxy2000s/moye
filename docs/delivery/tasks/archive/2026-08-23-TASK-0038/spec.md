# TASK-0038 Spec：Observer 与 Knowledge 旁路

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0006](../../../backlog/BL-0006.yaml)、[BL-0007](../../../backlog/BL-0007.yaml)

- `REQ-0038-01`：确定性 Observer 从 Lifecycle/Event/Attempt/Artifact 重建耗时、失败、重试、UNKNOWN 与 trace facts；
- `REQ-0038-02`：Observer 不推进 Task 且 Agent 崩溃时仍可用；
- `REQ-0038-03`：可选 OBSERVER_KNOWLEDGE 只生成候选和 disposition；
- `REQ-0038-04`：Closure 只要求 `none|proposed|deferred|applied` 明确处置，不要求候选；
- `REQ-0038-05`：旁路失败不能阻塞 Merge/Closure。
