# TASK-0077 Design

> 状态：Approved

领域层新增 `BacklogProblem`，并让 `BacklogProjection` 显式携带 `schemaVersion`、`affectedAreas`、`acceptanceOutline` 和可选 `problem`。兼容矩阵固定为：v1 文档没有 `problem` 且生成 v1 Projection；v2 文档必须严格具备完整 problem 并生成 v2 Projection；Runtime 新写入只接受完整 v2 Projection。已有 Runtime/Git v1 Projection 仍可作为当前状态被正式文档同步更新，不进行隐式迁移。

文档 Parser 按 `schema_version` 选择严格允许键集合，v2 对 `problem` 子对象单独拒绝未知字段。原始文件 SHA-256 继续作为 Document Source Digest；batch ID 继续绑定排序后的 source path/digest，Runtime 在合并前重新计算 batch ID 并验证每条 Projection。

同步是 ProjectBoard 唯一合法写入口之一：批次先全量校验再合并，源缺失仍 `PRESERVE`，同 digest 只归一化 `updatedAt`。本 Task 不改变 Workflow 状态机或直接触碰 Projection 存储。

