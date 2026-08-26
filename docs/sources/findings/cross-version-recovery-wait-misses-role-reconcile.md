# Finding：跨版本恢复等待器遗漏长 Role 的对账边界

> 状态：Resolved
> 发现日期：2026-08-26
> 来源：TASK-0074 跨真实 Commit Service 恢复验收
> 处置：[BL-0079](../../delivery/backlog/BL-0079.yaml) → TASK-0074

## 观察事实

`TASK-RCV-20260826024700-01-ROLE-RECOVERY` 已在旧 Service 完成 Architect 与 Implementation 边界标记。Documentation Role 随后完成真实 Codex 执行并落盘 Manifest，但在 Restate 回执确认前超过 Activity abort timeout，Workflow 正确进入 `WAITING_RECONCILE`，执行进程却仍存活。旧验收等待器只等待 Service 进程退出，因此最终超时，并在 `finally` 中删除了用于新 Service 的临时 Git snapshot。

使用该 Task 已绑定的 token、Run、Attempt 与 Manifest Digest 手工提交 `CONFIRMED` 后，同一 Workflow 从原 Evidence 继续，完成 Final Review 中断标记、恢复、Merge、Closure 与 Archive；没有重复已完成 Role。该运行证明 Runtime 对账路径有效，但因新版本 Commit object 随临时 snapshot 删除，不能作为最终可复验的跨版本发布证据。

## 根因

跨版本 Harness 把“目标故障点已发生”简化为“子进程已经退出”，没有同时观察正式 Projection 的 `WAITING_RECONCILE`。此外，新版本只存在临时 detached worktree，没有在运行前把 Commit 与 Tree 保存为独立可校验发布 Evidence。

## 修复

TASK-0074 的边界等待器同时观察子进程与 Core v2 Projection；遇到 Role `WAITING_RECONCILE` 时，只在绑定的 Manifest 已存在且 Run/Attempt/Digest 匹配后提交 `CONFIRMED`，不会发起第二个 Agent Run。新版本 snapshot 在启动前保存 Git bundle、Commit 和 Tree，超时预算覆盖真实长 Role；矩阵续跑可以复用前序已归档场景，只重跑尚无可靠证据的跨版本阶段。
