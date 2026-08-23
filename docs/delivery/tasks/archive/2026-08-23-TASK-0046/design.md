# TASK-0046 Design

> 状态：Accepted

ProjectBoard 继续只存 Workflow 发布的 `TaskProjection`。通用 Projection 增加可选 `runtimeState`、`workflowKind` 与 `historyKind` 展示事实；Core v2 的每次正式 `publish` 从当前 Workflow Projection 和输入来源写入这些字段，避免把 `WAITING_RECONCILE`/`ARCHIVE_FAILED` 压扁。Board Server 读取 snapshot 后只读查询 `TaskAuthority`，为遗留记录补齐 Workflow kind；验收历史兼容分类只接受已知验收 Task ID/标题约定，并返回分类来源，不把它当成业务状态。

前端在四列 Board 上方增加一条紧凑筛选带：Outcome、Workflow、历史类型与“最新成功”直达。卡片同时显示业务 outcome、运行阶段、Archive 与 Workflow；归档失败留在待处置列，等待对账留在进行中列，但两者有独立高对比状态。

状态机节点仍由 Definition + Event History 派生。`NOT_VISITED` 的异常/恢复节点明确标记“合法但本次未发生”；`VISITED/CURRENT` 才能显示“本次经过”。Agent Events 的 API、cursor、分类和 `<dialog>` 路径保持不变。
