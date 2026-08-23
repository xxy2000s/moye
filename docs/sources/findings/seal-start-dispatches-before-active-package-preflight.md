# seal-start 在 Active package 预检前提交 Runtime Invocation

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-24

CLI `seal-start` 只校验输入可以构造 Task Projection，随后立即发送 `SealedTaskWorkflow/<task_id>`。Active Task package、Manifest identity、HEAD/Base 与 Archive path 直到 Workflow 的第一条 `prepare-seal-intent` durable command 才被检查。

真实 `SealedTaskWorkflow/TASK-0049` 因 package 尚未存在而在该 command 连续失败五次，最终 Invocation 以 Failure Output 完成；失败发生在 Authority claim、Intent/Projection 持久化和 Board upsert 之前，因此没有可归档的业务 Task Projection，也不满足现有 rejected-Evidence Seal Recovery 的前置条件。Workflow key 又不能重提。

修复应在 CLI `send()` 前复用同一只读 `createSealIntent` 校验，同时保留 Workflow 内兜底和最终 Commit Gate。工作项：[BL-0060](../../delivery/backlog/BL-0060.yaml)。真实过程见 [Incident](../incidents/2026-08-24-task-0049-seal-start-before-package.md)。
