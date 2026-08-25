# TASK-0061R1 Spec：稳定 Core v2 重放配置并恢复 Journal mismatch

> 状态：Accepted
> Spec Revision：1

- `REQ-0061R1-01`：Core v2 输入与验收授权校验必须位于 durable boundary，部署环境变化不得让已开始 Workflow 走出不同 Journal 路径；
- `REQ-0061R1-02`：新的错误配置必须形成稳定、可解释的 durable command failure，而不是 pre-dispatch Handler Return 分叉；
- `REQ-0061R1-03`：Recovery Inspector 只在 source owning Invocation 已暂停、错误精确为 Restate 570 Journal mismatch、相关 index 为 1 且 Source Projection 符合 stalled eligibility 时接受 HandlerReturn recovery；
- `REQ-0061R1-04`：真实 `TASK-RCV-20260825185538-01-SESSION-CAPTURE` 必须通过 append-only successor 完成 Failure Closure、Knowledge Disposition 和 Archive，保留全部原 Workflow、Attempt、Session、Event 与失败原因；
- `REQ-0061R1-05`：恢复不得执行 Implementation、Test 或 Merge，不得取消原 Invocation、重提原 Workflow key 或直接修改 Projection。
