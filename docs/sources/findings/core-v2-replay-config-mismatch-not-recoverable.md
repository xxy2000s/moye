# Core v2 重放读取部署开关会产生不可恢复的 Journal mismatch

> 文档类型：Finding
> 状态：Open
> 发现日期：2026-08-25
> 发现 Task：TASK-0061

`TASK-RCV-20260825185538-01-SESSION-CAPTURE` 在修复 Codex Parser 后通过 Restate 正式 `resume --deployment latest` 接管。新部署首次启动时遗漏 `MOYE_ACCEPTANCE_FAULT_INJECTION=enabled`，`CoreV2Workflow.run` 在第一个 durable command 前读取进程环境并返回 Terminal Error；随后以正确开关恢复时，Restate 检测到 Journal index 1 从 `handler return` 变成 `call`，产生 `570 Journal mismatch`。

原 owning Invocation `inv_1360ZAEX4nJl3xsrzeiOS0IlUKug0LTSaN` 已用 Restate 正式 Pause 保留。Projection 仍是 `EXECUTING / TEST_EXECUTION_REQUIRED`，此前五个 Role、Attempt、Session 和 Artifact 均未删除或覆盖。现有 append-only Failure Recovery Inspector 只接受暂停在 durable `Run` command 的 Invocation，不能为暂停在 `HandlerReturn` mismatch 的源 Workflow 形成合法 Failure Closure/Archive。

这证明验收授权开关不能在 Workflow replay 的非持久化分支中直接改变代码路径；同时，已经发生的 pre-dispatch Journal mismatch 需要可验证的 append-only recovery successor，不能靠取消、重提 key 或修改 Projection 收敛。
