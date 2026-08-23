# Core v2 Role scope 遇到符号链接路径后在 Activity 重试

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-23

真实 Task `TASK-CORE-V2-MERGE-UNKNOWN-001` 使用 macOS `/tmp/...` 仓库路径；该路径实际解析到 `/private/tmp/...`。CoreV2Workflow 在 claim Authority 和写入 `ARCHITECT_REQUIRED` 后，Role Activity 才由 `physicalDirectory()` 拒绝 `scopeRoot must be a physical directory`。Restate 正确保留 Journal 并重试 Activity，但业务状态无法前进。

Workflow 应在同一个 durable Role Activity 内将已授权 repository root canonicalize 后交给 Role Runtime，使原 Invocation 可在新部署上接管；不能换 Task key、直接终止 Projection 或跳过 Role。
