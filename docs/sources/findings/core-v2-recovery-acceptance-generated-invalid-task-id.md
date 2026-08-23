# Core v2 Recovery Acceptance 生成了非法 Task ID

> 文档类型：Finding
> 状态：Fixed by TASK-0044
> 发现日期：2026-08-23

TASK-0044 首次运行 `npm run acceptance:core-v2:recovery` 时，Harness 把完整场景名拼入 Task ID，生成 `TASK-RECOVERY-20260823123815-01-TEST_CONFIRMED`。该值包含下划线且超过领域长度约束，真实 Restate Invocation `inv_1ctICRcGGK6n5HK9dsdRnkAG5oJWtpGnJx` 因 `INVALID_TASK_ID` 进入 durable backoff，未形成 Task Projection。

该调用已通过 Restate invocation cancel API 合法终止并保留历史，没有重用 Workflow key，也没有修改 Projection。修复后 Harness 使用短场景码生成满足 `TASK-[A-Z0-9-]{1,64}` 的 ID，并在提交前执行同一正则断言；Service/Board 随机端口也增加去重，Service 日志写入每次 acceptance run root。

复验证据由 TASK-0044 的最终未筛选真实恢复矩阵提供；原失败尝试目录保留在 `.moye-runtime/acceptance/core-v2/recovery-20260823123815-9822/`。
