# Core v2 Workflow 未实际执行智能 Observer/Knowledge

> 文档类型：Finding
> 状态：Fixed by TASK-0045
> 发现日期：2026-08-23

Core v2 Architecture 已把 `OBSERVER_KNOWLEDGE` 定义为可选、非阻塞旁路角色，Role Runtime 也允许该 Role/Phase；但 `CoreV2Workflow` 当前只在 Verification Gate 后直接写入 `Knowledge Disposition: none`，没有实际创建 Observer Attempt 或运行真实 Agent。

因此现有单元测试只能证明确定性 Observer 可投影，以及 Workflow 可以记录 `none/deferred`，不能证明“智能 Observer/Knowledge Agent 失败或超时不会阻塞主流程”。这与产品验收要求存在证据缺口。

TASK-0045 将接入显式可选的真实旁路 Role：确定性 Observer 先形成事实报告，智能 Agent 只读消费；其失败或超时记录真实 Attempt/Event/Manifest 并降级为 `deferred`，不得推进状态、决定 Gate、阻塞 Merge/Closure，且候选不得自动写为 Accepted ADR。
