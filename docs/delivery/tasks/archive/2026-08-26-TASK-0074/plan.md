# TASK-0074 Plan

> 状态：In Progress

1. 参数化真实 Core v2 fixture/test contract。
2. 建立 Node/Python/Minimal Git 成功、Repair、Reconcile 和失败归档矩阵。
3. 建立旧/新真实 Commit Service 的运行中恢复与已归档一致性验证。
4. 重跑 clean package/container，聚合统一产品 Evidence。
5. 完成文档、仓库门禁、唯一 Result Commit 与 Seal。
6. 修复首轮发现的 Service 授权前置条件与 Invocation 空轮询，使用新 Workflow key 重跑并保留原失败历史。
7. 修复长 Role 在进程退出前进入 WAITING_RECONCILE 的边界观察，持久保存新版本 Git snapshot Evidence，并只续跑缺失阶段。
