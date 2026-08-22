# Incident：本地 Restate 容器重建后 Board 历史投影丢失

> 状态：Resolved / Follow-up scheduled
> 日期：2026-08-22
> 严重级别：Development data loss
> 负责人：Moye
> 来源或关联 Task：TASK-0027 后的本地页面验收

## Summary

本地手工启动的 Restate 容器没有挂载 `/restate-data`。容器停止并重建后，原容器内的 TaskAuthority、Workflow Journal 和 ProjectBoard Projection 不再可用，页面只剩新 Runtime 中重新写入的任务。

Git 中 `docs/delivery/tasks/archive/` 的 27 个 Task Artifact 包没有丢失；丢失的是另一事实域中的 Runtime 投影。当前服务已改用宿主机 `.moye-runtime/restate-live` 挂载到 `/restate-data` 并验证容器重启后 `TASK-0027` 与 Backlog Projection 仍存在。

## Impact

- 旧页面运行态历史无法从原容器读取；
- 用户看到的任务数量与 Git 中的 27 个归档包不一致；
- Task Artifact 仍在 Git，可审计 Spec、Plan、Verification 和 Docs Impact；
- 不能把扫描 Git 目录生成的列表冒充原始 Workflow Journal 或 Domain Event History。

## Timeline

| 时间 | 事件 |
|---|---|
| 2026-08-22 | 页面验收发现 Board 只剩少量新任务 |
| 2026-08-22 | 检查确认 `docs/delivery/tasks/archive/` 中 27 个归档包均在 Git |
| 2026-08-22 | 确认旧 Restate 容器未配置持久化数据挂载 |
| 2026-08-22 | 当前 `moye-restate-live` 改为挂载 `.moye-runtime/restate-live:/restate-data` |
| 2026-08-22 | 重启容器后确认 `TASK-0027` 和 Backlog Projection 仍可查询 |

## Detection

用户在真实 Board 页面核对历史任务数量时发现。此前手工 Runbook 使用 `docker run --rm`，没有把“容器重建后 Projection 仍在”列为验收项。

## Root Cause

Restate 的持久状态只存在于未挂载宿主或命名卷的容器可写层；删除或重建该容器即删除对应数据层。Git Task Artifact 与 Restate Runtime Projection 是不同权威，系统也没有从 Artifact 显式重建 Runtime 的导入/对账流程。

## Contributing Factors

- 手工启动 Runbook 使用临时容器语义；
- Board 只展示 ProjectBoard Projection，没有同时说明 Git Archive Catalog 的数量；
- 缺少本地持久化启动/停止命令和重启验收步骤。

## Resolution

当前实例已经使用宿主目录持久化并完成一次重启核对。本次后续 Task 将提供可重复的 Compose 持久化入口，修正文档，并继续保持“Git Archive 不冒充 Runtime History”的权威边界。

## Evidence

- `find docs/delivery/tasks/archive -mindepth 1 -maxdepth 1 -type d -name '*-TASK-*'` 返回 27 个目录；
- `git ls-files docs/delivery/tasks/archive` 返回 240 个受版本控制文件；
- `docker inspect moye-restate-live` 显示 `.moye-runtime/restate-live` 挂载到 `/restate-data`；
- 重启后 `GET /api/board` 仍返回 `TASK-0027` 与 4 个 Backlog Projection。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0030 | Prevent / Clarify | 持久化本地 Restate，并明确 Git Archive 与 Runtime Projection 的恢复边界 | Converted to TASK-0028 |

## Immediate Action Items

| 行动 | 类型 | 负责人 | 截止时间 | 状态 |
|---|---|---|---|---|
| 当前 live 容器挂载 `/restate-data` 并重启核对 | Mitigate | Moye | 2026-08-22 | Done |
| 增加可重复的持久化 Compose 入口与 Runbook | Prevent | TASK-0028 | 2026-08-22 | Done |

## Knowledge Promotion

- 是否形成 Pitfall：本次更新既有 Durable Runtime Pitfall；
- 是否需要 ADR：否，不改变 Restate PoC 选型；
- 是否更新 Architecture/Runbook：更新 Restate PoC Architecture 与本地 Runbook。
