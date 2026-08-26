# TASK-0075 Seal 提交到非 canonical Restate Runtime

> 文档类型：Incident
> 状态：Resolved by explicit dual-runtime closure and canonical handoff
> 日期：2026-08-26
> 关联任务：TASK-0075、TASK-0075R1

## 影响

W10 的 `SealedTaskWorkflow/TASK-0075` 首次提交被默认 `RESTATE_INGRESS_URL=http://127.0.0.1:8080` 接收；M1 与 M2-W01～W09 的 canonical Runtime 实际位于 `50889/50890`。两个 Runtime 的 Journal/Projection 相互独立，不能复制或直接修正，因此 TASK-0075 不会出现在 canonical Board。

已完成的 M1/W01～W09、Git 与 Artifact 未被改写；错误 Runtime 上的 Invocation 和 Projection 保留为真实历史。

## 时间线

- `2026-08-26T12:18`：CLI 使用默认入口提交 TASK-0075，返回 Invocation `inv_13FHnJo20fEh3C2hgTxzbD81aBvxBgYRmg`；
- 初始 Invocation 因旧 deployment `:61424` 不可达进入 backoff；
- 当前 Service `:55900` 注册到旧 Admin 后，TASK-0075 生成 durable Seal Intent 并停在 `waiting-result-commit`；
- 对 `50889` 与 `8080` 交叉查询 TASK-0065、TASK-0074、TASK-0075，确认前两项只存在于 canonical Runtime，TASK-0075 只存在于旧 Runtime；
- 决定不重复相同 Workflow key、不复制 Projection：TASK-0075 在原 Runtime 完成 Seal，canonical Runtime 使用独立 TASK-0075R1 记录同一 W10 Result Commit 的 handoff。
- E2E 连续正确拒绝 BL-0080 的非规范 `reliability` 与大写 `BUG` kind；改为文档 Schema 允许的小写 `bug` 后重跑完整 E2E。

## 根因

本机同时存在两组有效 Restate 隧道。CLI 的默认端口是 `8080/9070`，而本轮长任务交接中 canonical 端口是 `50889/50890`；Seal Start 只校验仓库 Task package/base，没有可用的 Runtime cluster identity 或前置 Task 探针。执行者未在首次命令显式设置入口。

## 处置与防复发

- 两个 Workflow 都通过正式 Seal/Archive 路径收敛，共享同一 W10 Result Commit 但使用不同 Task key；
- 最终 Board 与 Service 继续绑定包含 M1/M2 历史的 canonical Runtime；
- Release/Seal Runbook 要求显式设置 ingress/admin，并在提交前查询前置 Task；
- 不删除旧 Invocation，不把 Git 目录扫描结果写成 Runtime 状态。
