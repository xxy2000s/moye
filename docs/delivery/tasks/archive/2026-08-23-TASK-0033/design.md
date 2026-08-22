# TASK-0033 Design

`core-v2-lifecycle.ts` 是逐 Task 扩展的纯 Workflow Reducer。首片只允许 `ARCHITECT_REQUIRED → DESIGN_REVIEW_REQUIRED → IMPLEMENTATION_REQUIRED | REPLAN_REQUIRED`。它消费 TASK-0032 的成功 Role Attempt/Evidence并生成 TASK-0031 的 Lifecycle Artifact；Agent 建议不能直接推进状态。

Architect 的一个隔离 Attempt 可以生产 Spec/Design/Plan，因此 Lifecycle Artifact 同时接受 v2 `ARCHITECT` phase 与早期按 Artifact kind 的兼容 phase。Role Attempt ID 改为稳定 identifier segment，确保能作为 Artifact Producer ID。
