# TASK-0049 在 Active package 落盘前启动 Seal

> 状态：Resolved by replacement Task and dispatch preflight  
> 日期：2026-08-24  
> 严重级别：Medium  
> 来源或关联 Task：TASK-0049、TASK-0049R1

## Summary

执行者在 Active Task package 写入前提交了 `SealedTaskWorkflow/TASK-0049`。Workflow 的第一条 `prepare-seal-intent` durable command 找不到 `docs/delivery/tasks/TASK-0049`，重试耗尽后 Invocation 以 Failure Output 完成。没有 Authority、Intent、Projection 或 Board row 被创建；原 Workflow key 永久保留且没有重提。

## Impact

- `TASK-0049` 不能继续使用普通 Seal 或现有 rejected-Evidence Recovery；
- 没有产品代码、历史 Task、Runtime Projection 或 Board 数据被删除或覆盖；
- Roadmap 修正与预检修复由新 Task `TASK-0049R1` 接管。

## Timeline

| 时间（Asia/Shanghai） | 事件 |
|---|---|
| 04:30 | `seal-start` 接受 TASK-0049，Invocation `inv_14WMLTdctFwz3TAplbgy2bCQyx00IWI42o` 创建 |
| 04:30～04:35 | `prepare-seal-intent` 因 Active package 不存在累计失败五次 |
| 04:35 | Invocation 写入 `Command: Output / Failure` 并完成；`seal-status`、TaskAuthority 与 Board 均为空 |
| 04:35 | 尝试 Resume 返回 HTTP 409：Invocation 已 completed，未 purge 或重提 key |
| 04:39 | 新建 TASK-0049R1；CLI 增加发送前 preflight，定向测试通过 |

## Root Cause

Skill 要求先创建 Active package，但 CLI 没有把该前置条件变成派发前的可执行门禁。相同检查只存在于 Workflow 第一条 durable command，输入错误因此消耗了不可重用的 Workflow key。

## Resolution

- 原 Invocation、Journal Failure 和输入文件保留；
- 不把 TASK-0049 伪造成 `FAILED_TERMINAL`，因为业务聚合从未创建；
- TASK-0049R1 在 `seal-start` 发送前调用与 Workflow 相同的 `createSealIntent`；
- Roadmap 修正由 TASK-0049R1 的独立 Result Commit 和新 Workflow key 完成。

## Evidence

- Invocation：`inv_14WMLTdctFwz3TAplbgy2bCQyx00IWI42o`；
- Target：`SealedTaskWorkflow/TASK-0049/run`；
- Journal：index 3 `Command: Run prepare-seal-intent`，index 4 `Notification: Run / Failure`，index 5 `Command: Output / Failure`；
- `seal-status TASK-0049`：`null`；
- replacement Invocation：`inv_1bYpHmRWTJYF0QKyRGuzlrVhJWVJL2N4qw`。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0059 | Docs | 修正 Roadmap 的 Runtime 终态与 Receipt 台账 | Converted to TASK-0049R1 |
| BL-0060 | Prevent | 在 `seal-start` 发送前执行同源 preflight | Converted to TASK-0049R1 |

## Knowledge Promotion

- Pitfall：更新 Durable Task Runtime Pitfalls；
- ADR：不需要，状态所有权与两阶段 Seal 决策未改变；
- Architecture/Runbook：更新 Sealed Result Commit 的三层校验与操作顺序。
