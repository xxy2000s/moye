# TASK-0078 Design

> 状态：Approved

数据补录直接修改五个 Git Backlog 文档，使用 TASK-0077 冻结的 v2 合同。Evidence 仅引用稳定的 Architecture/Task/Backlog/API 标识，不复制实现计划。BL-0031 不修改；正式 `loadBacklogSyncBatch` 会把其既有 v1 converted 事实与五个 v2 文档放入同一个原子批次。

正式 CLI 用重复 `--id` 选择 canonical 目录中的严格子集，loader 先验证 ID 语法、重复、缺失和六份完整文档，再构造一个 batch；source path 仍是 `docs/delivery/backlog/BL-*.yaml`，不会复制到临时目录或改变文档所有权。运行时顺序固定为：构建当前 HEAD → 平滑替换 canonical Service/Board → 注册存活 Endpoint → 只读核对旧 Board → CLI 正式 subset sync → 只读核对新 Board → 重放完全相同 batch。所有命令显式使用 `50889/50890`；sync handler 是唯一 ProjectBoard 写入入口。

Sync Receipt 与 Board 摘要保存到 Task package 的 JSON Evidence。Service 进程切换不得删除 Restate 数据或历史 Artifact；旧 Runtime 保持停止。
