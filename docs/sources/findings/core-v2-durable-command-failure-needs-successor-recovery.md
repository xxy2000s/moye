# Core v2 durable command 失败后缺少合法 successor recovery

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-23

真实 Task `TASK-CORE-V2-MERGE-UNKNOWN-001` 在 Role 路径校验 command 失败，`TASK-CORE-V2-MERGE-UNKNOWN-003` 在旧 Failure Artifact command 冲突，`TASK-CORE-V2-MERGE-UNKNOWN-004` 在 Repair Candidate 无变更 command 失败。三者都证明：一旦错误由 `ctx.run` 写入 Journal，外层 TypeScript `catch` 不一定能继续执行 Failure Closure；热修部署也不能清除已经 journaled 的 command failure。

这些原 Workflow、Attempt、Session、Event 和失败 command 必须保留。需要一个窄化的 append-only Core v2 stalled-invocation recovery successor：校验原 Invocation/Projection/Digest 和允许的失败类别，取得 Authority 后只完成失败 Closure/Archive，不重跑 Agent、Test 或 Merge。禁止 cancel/purge 后复用 key，也禁止直接修改 Board Projection。
