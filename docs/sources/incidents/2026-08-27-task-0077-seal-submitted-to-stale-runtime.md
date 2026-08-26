# TASK-0077 Seal 首次提交到已遗留的非 canonical Runtime

> 文档类型：Incident
> 状态：Contained；dual-runtime closure 等待 TASK-0077 Result Commit
> 日期：2026-08-27
> 关联任务：TASK-0077、TASK-0083
> 前序同类事件：[TASK-0075 Seal 提交到非 canonical Runtime](./2026-08-26-ga-seal-submitted-to-stale-runtime.md)

## Summary

M3-W01 启动时 Shell 未设置 `RESTATE_INGRESS_URL` / `RESTATE_ADMIN_URL`，CLI 再次使用默认 `8080/9070`，而包含 108 个归档 Task 的 canonical Runtime 位于 `50889/50890`。`SealedTaskWorkflow/TASK-0077/run` 因旧 Deployment 指向死亡端点 `55900` 先进入 backoff；恢复端点后在旧 Runtime 生成合法 Seal Intent。

本次没有直接修改 Projection、删除 Invocation 或重建 Runtime。相同 frozen package 随后使用显式 canonical 端点创建同 ID Workflow；两个 Runtime 生成完全相同的 Intent Digest 与 Token，因此将由同一个 TASK-0077 Result Commit 合法收敛。

## Impact

- TASK-0077 一度只存在于旧 Runtime，canonical Board 没有该 Task；
- 旧 Runtime 日志持续重试已经死亡的 Service Endpoint；
- 约 14 个验收/恢复 Service 进程长期存活，增加端点归属判断噪音；
- Git、Artifact、108 个 canonical 归档 Task 和 5 个 Backlog 未受影响。

## Timeline

| 时间 | 事件 |
|---|---|
| 2026-08-27 01:40 | TASK-0077 `seal-start` 由默认 `8080` 接收；返回 Invocation `inv_15H2de6WN2V41Bcs44yfka9I0teRPqLB3u` |
| 01:44 | 旧 Runtime 的 Deployment URI 被合法 handoff 到存活 Service `55923`；Workflow 生成 Intent `sha256:f258cfff…b391` |
| 01:47 | 使用显式 `50889/50890` 在 canonical Runtime 创建同一 TASK-0077；Intent/Token 与旧 Runtime 完全一致 |
| 01:49 | 审计两套 `sys_invocation`：canonical 仅有 7 个历史 paused Invocation；旧 Runtime 仅 TASK-0077 suspended 与 4 个 paused 只读查询 |
| 01:50 | 14 个无活动 Invocation 引用的历史 Service 正常 SIGTERM；保留 canonical `55923/3000` 与 paused Invocation 引用的 `9136/3014` |
| 01:51 | `docker stop moye-restate-1`；保留容器与 `moye_restate_data` 卷，默认 `8080/9070` fail closed |

## Root Cause

前序 TASK-0075 事故只把显式端点检查写入 Release Runbook，没有让所有本地 Task/Seal 操作在多 Runtime 环境中先验证 cluster identity。CLI 的可移植默认仍是 `8080/9070`；执行 Shell 没有持久化 canonical 环境，导致同一故障复发。

## Resolution and Follow-up

- 当前 M3 的所有 Runtime 命令显式绑定 `50889/50890`；
- 旧 Runtime 停止但不删除，TASK-0077 Result Commit 形成后临时启动并提交同一 Evidence，再次停止；
- canonical paused Invocation 与全部历史 Deployment/Journal 保留，未执行 purge/remove；
- TASK-0083 更新本地 Runbook 与最终验收，要求在 Seal 前探测 canonical Board 历史和 Runtime identity；不改变项目可移植默认端口。

## Evidence

- canonical：`moye-restate-live`，Ingress/Admin `50889/50890`，bind 数据 `.moye-runtime/restate-live`；
- canonical Board：108 archived、5 backlog，TASK-0077 在 `waiting-result-commit`；
- old：`moye-restate-1`，volume `moye_restate_data`，14 archived、4 backlog，TASK-0077 在 `waiting-result-commit`；
- 两边 Intent Digest：`sha256:f258cffffc6a5b4c9a5e887b233ae02d7cc8a3991fbea560d9d31ea6040db391`；
- 两边 Token：`sha256:06e650ebe9f2581efcf40c260b87526ce0f69fc8043dfbc01a1a20c04b4808cc`。

