# Core v2 Role Intent-only 没有投影为 WAITING_RECONCILE

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23

真实 Task `TASK-ACCEPT-20260823171349-01-HAPPY` 在 Final Review 的 `execution-intent.json` 已持久化、Manifest 尚未确认时发生 Service/Runtime 中断。`RealRoleRuntimeV2` 正确返回 `REAL_ROLE_RESULT_UNKNOWN` 并禁止第二次 Agent Run，但异常发生在 Restate durable command 内，CoreV2Workflow 没有机会发布业务 Projection，导致 Invocation 只表现为 backing-off，Board 无法显示正确 token、Attempt、Role phase 和恢复选择。

修复必须让 durable command 把 Role UNKNOWN 转换为确定性返回值，由 owning Workflow 记录 `WAITING_RECONCILE` 和 pending Role identity。正确 token 的 `CONFIRMED` 只能复用通过 Digest 校验的真实 Manifest；`NOT_APPLIED` 首版不盲目重跑 Role，而是保留失败 Attempt 并完成失败 Closure/Archive。错误 token、冲突 Evidence 和相同 Evidence 重放必须分别拒绝、拒绝、幂等。
