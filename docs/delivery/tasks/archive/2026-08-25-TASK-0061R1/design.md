# TASK-0061R1 Design

把依赖 `MOYE_ACCEPTANCE_FAULT_INJECTION` 的输入校验包进命名固定的首个 `ctx.run`。第一次执行的成功或 Terminal Failure 都由 Restate Journal 固化；重放直接消费原结果，不再读取部署进程环境决定 Workflow 控制流。

扩展 `CoreV2SourceInvocationFact` 为两个窄化类别：既有 `DURABLE_RUN`，以及仅用于已发生历史故障的 `PRE_DISPATCH_HANDLER_RETURN_MISMATCH`。后者必须同时满足 owning target、`paused`、错误含 Restate 570 Journal mismatch、related index=1；Fact Digest 绑定错误摘要和类别。Recovery Workflow 仍复核 Source Projection Digest 与 TaskAuthority，然后只创建 append-only Failure Closure/Archive successor。

本设计不尝试继续原成功路径；Journal mismatch 后已无法证明原 Handler 的确定性重放，合法处置是保留源历史并形成失败归档。后续新 Task 已由 durable validation 防止同类分叉。
