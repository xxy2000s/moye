# Finding：Framework 产品矩阵未预检验收 Service 授权

> 状态：Resolved
> 发现日期：2026-08-26
> 来源：TASK-0074 首轮真实 External Project Product Matrix
> 处置：[BL-0077](../../delivery/backlog/BL-0077.yaml) → TASK-0074

## 观察事实

首轮 `npm run acceptance:framework` 成功提交了 `TASK-ACCEPT-20260826010539-01-HAPPY`，但它绑定的既有 Service 未开启产品验收授权。Restate Invocation 在 22ms 内以 `[403] Core v2 product acceptance metadata is disabled` 完成失败，Projection 始终为 `null`；旧 Harness 仍只轮询 Projection，预计会空等 25 分钟。

## 根因

统一 Framework 产品矩阵依赖调用者事先以正确环境启动并注册 Service，却没有在命令内部建立该前置条件；同时场景 Harness 没有关联查询已接受 Invocation 的终止失败事实。

## 修复

TASK-0074 让矩阵入口自行启动、注册和有界回收验收专用 Service，并显式开启受控 acceptance/test fault injection。场景等待器同时查询 Restate `sys_invocation`，当 Invocation 在 Projection 创建前失败时立即保留原失败并报错。原失败 Invocation 与 Task ID 不删除、不重提；修复后使用新的 Workflow key 执行产品矩阵。
