# Core v2 共享 Failure Artifact Root 导致跨 Task 冲突

> 文档类型：Finding
> 状态：Confirmed / Fixed by TASK-0041
> 发现日期：2026-08-23

真实 Task `TASK-CORE-V2-MERGE-UNKNOWN-003` 在 Final Review 失败后持久化 Failure Artifact 时，与先前 `TASK-CORE-V2-MERGE-UNKNOWN-002` 的 `<artifactRoot>/failure/failure.json` 发生内容冲突。两个 Task 合法共用 Artifact Root，但旧布局没有 Task 命名空间，失败 Closure 因此卡在 durable command。

TASK-0041 将 Failure、Closure、Archive Receipt 的物理路径改为 `<artifactRoot>/<taskId>/<kind>/...`，保留原 `core-v2-artifact://<taskId>/...` 逻辑引用，并以两个真实 Task ID 共用一个 Artifact Root 的回归测试证明互不覆盖。
