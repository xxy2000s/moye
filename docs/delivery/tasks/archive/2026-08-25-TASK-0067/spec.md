# TASK-0067 Spec

> 状态：Approved
> Milestone：M2-W02
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

交付版本化 `.moye/project.yaml`、机器可读 JSON Schema、确定性默认值与迁移/拒绝机制，并提供 `moye init` 和 `moye project validate`。

## Requirements

- `REQ-0067-01`：Schema v1 覆盖项目、仓库、Agent、测试、文档策略、Workflow、Artifact 与隐私策略。
- `REQ-0067-02`：所有文件路径必须是仓库内相对路径；命令必须是非空 argv，拒绝 shell 字符串、越界和符号链接逃逸。
- `REQ-0067-03`：`moye init [--dir] [--force]` 幂等生成安全默认配置；默认不覆盖已有文件。
- `REQ-0067-04`：`moye project validate [--file]` 输出 canonical digest、resolved repository 与版本/capability 摘要。
- `REQ-0067-05`：旧 schema 可显式迁移到 v1；未来/不支持 schema 以稳定错误码拒绝，不静默猜测。
- `REQ-0067-06`：单元测试覆盖正常、默认值、迁移、危险命令、路径越界、symlink、覆盖保护和 deterministic digest。

## 非目标

- 不在本 Task 提交真实 Core v2 Task；属于 W03。
- 不实现第三方 Plugin 执行、Documentation Policy Gate 或容器分发。
