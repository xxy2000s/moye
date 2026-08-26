# 验收 Service 停止后 Restate 最新 Deployment 仍指向已退出进程

> 文档类型：Finding
> 状态：Confirmed / TASK-0076
> 发现日期：2026-08-26

## 现象

真实 Recovery/Guard/Framework 验收会注册临时 Service revision，完成后终止进程，再通过 `POST /deployments` 重新注册旧 GA URI。Restate 仍把新 Invocation 路由到 revision 更高、但进程已经退出的临时 Deployment，Board 的 Session/Trace 请求因而超时或显示 Runtime unavailable。

## 根因

重新提交一个已经登记过的旧 URI 只返回它原有的 Deployment/revision，不会把它提升为最新 revision。Harness 把“endpoint 重新注册成功”误当成“最新 revision 已经安全回切”。

## 正确处置

Harness 在注册临时 Service 前记录当前 `CoreV2Workflow` 最高 revision 的 URI；临时 Deployment 注册后保存其 Deployment ID；退出前通过 Restate Admin `PATCH /deployments/<id>` 把该最新 revision 的 URI 交回仍运行的前序 Service，然后才停止临时进程。不得强制删除 Deployment 或终止在途 Invocation。
