# TASK-0039 Spec：统一 Core v2 Workflow

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0040](../../../backlog/BL-0040.yaml)

- `REQ-0039-01`：一个 keyed Restate Workflow 串起 Intake 至 Archive，只有 Workflow 推进主状态；
- `REQ-0039-02`：五类主流程 Agent 使用真实 Runner，两次 Review/两次 Test Attempt 隔离并展示原始 Event；
- `REQ-0039-03`：真实 Trusted Runner、Verification Gate、Merge/Closure/Archive Evidence 可追踪；
- `REQ-0039-04`：Repair/Replan/Reconcile/预算/Observer 降级有唯一明确路径；
- `REQ-0039-05`：CLI 可发起/查询，Web Board 展示同一投影与完整节点细节；
- `REQ-0039-06`：最终真实 Agent、进程、Git、Restate 验收，不允许产品路径 Fake/Mock。
