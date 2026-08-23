# TASK-0045 Spec：预算、Observer/Knowledge 与 stale fencing 真实验收

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)

- `REQ-0045-01`：使用真实 Agent 连续产生 Blocking Implementation Finding，达到固定 Repair 预算后形成唯一 `FAILED_TERMINAL`，不得再调用 Documentation、Test、Final Review 或 Merge，并完成 Failure Closure/Archive；
- `REQ-0045-02`：多个真实 Spec Revision 均无法通过 Design Review，达到固定 Replan 预算后唯一失败；旧 Revision Artifact/Attempt/Evidence 全部保留，已被取代的 Revision 显式失效，并完成失败归档；
- `REQ-0045-03`：确定性 Observer 始终从 Projection/Event/Attempt/Session/Artifact 重建，不依赖智能 Agent；
- `REQ-0045-04`：接入可选真实 `OBSERVER_KNOWLEDGE` 旁路；真实 Agent 失败或超时只产生 `deferred` Knowledge Disposition，不阻塞 Verification Gate、Merge、Closure 或 Archive；
- `REQ-0045-05`：Knowledge Disposition 只能是 `none | proposed | deferred | applied`，智能 Observer 的候选不得自动升级为 Accepted ADR；
- `REQ-0045-06`：用真实旧 Generation/Revision Attempt 与 Manifest 执行只读 fencing audit；错误 Manifest Digest 拒绝，正确旧 Evidence 明确返回 stale rejection，重复审计幂等且 Projection Digest 不变；
- `REQ-0045-07`：每个场景使用独立真实 Core v2 Task、Codex、Restate、隔离 Git、真实 Artifact/Session/Event/Closure/Archive；失败 Task 必须 `CLOSED + FAILED_TERMINAL + ARCHIVED`，旁路失败 Task 必须 `CLOSED + SUCCEEDED + ARCHIVED`；
- `REQ-0045-08`：提供非交互、可重复的 `npm run acceptance:core-v2:guards` 入口，并通过全库、E2E、Docs Impact 与唯一 Result Commit Seal。

完整多 Daemon Lease/Fencing 仍不在 PoC 范围；本 Task 验收当前单 owning Workflow 下的 Attempt/Generation/Revision fencing，并在结果中明确该限制。
