# TASK-0082 Spec

> 状态：Approved
> Milestone：[M3 W06](../../../milestones/m3-backlog-and-session-clarity.md)
> 前置：[TASK-0070](../2026-08-25-TASK-0070/spec.md)、[TASK-0075](../2026-08-26-TASK-0075/spec.md)

## 目标

为消费级 `moye` CLI 增加显式、版本化的标准文档脚手架，使仓库外的空白 Git 项目可以建立最小可导航文档控制面，并把真实确定性验证命令冻结到 `.moye/project.yaml`；任何既有内容都不得被静默覆盖。

## Requirements

- `REQ-0082-01`：冻结公共命令 `moye init --docs standard [--apply] [--dir PATH] [--project-id ID]`。不带 `--docs standard` 的既有 `moye init` 只初始化 Project Manifest；标准脚手架默认只输出确定性计划，只有 `--apply` 写入。
- `REQ-0082-02`：模板版本固定为 `standard-docs-v1`，最小结构包含 `AGENTS.md`、项目 `README.md`、Docs 总入口、Sources/Delivery/Knowledge/Meta 索引、Backlog/Task 模板、项目内验证脚本、`.moye/project.yaml` 与内容寻址 Scaffold Manifest。
- `REQ-0082-03`：写入前解析真实项目根、拒绝非 Git/路径越界/符号链接逃逸，计算每个目标的 `create | unchanged | conflict` 与 Digest；存在任一不同字节目标时整批 fail closed，不写其他文件。
- `REQ-0082-04`：`--apply` 只以 exclusive create 写缺失目标；相同模板重复执行返回全部 `unchanged` 与相同 Scaffold Digest。不同 template version、被修改的生成文件、已有 README/AGENTS/docs/Manifest 均稳定拒绝；`--force` 不能绕过。
- `REQ-0082-05`：生成的 Project Manifest 使用 `documentation.policy: custom` 与 argv-only `node scripts/docs_validate.mjs`；验证脚本只按 Scaffold Manifest allowlist 校验路径和 SHA-256，不扫描、迁移或补写项目文件。
- `REQ-0082-06`：公共 npm tarball 包含实现与 CLI help；内部 CLI 保持同一命令语义，不复制不同状态机。
- `REQ-0082-07`：单元/集成覆盖 plan/apply/idempotency/conflict/symlink/race；真实验收只使用仓库外临时 Git 项目，从临时 pack 安装 CLI，证明空白初始化、冲突不覆盖、重复执行、project/docs validate 与 clean Git diff。
- `REQ-0082-08`：脚手架项目执行一个真实 Standard/Core v2 Task，产品事实与文档同时更新，真实 Documentation Agent、custom deterministic Gate、Test/Review/Closure/Archive 全部形成 Evidence；若首次 Candidate 缺文档则必须通过既有 Repair 收敛。

## 非目标

- 不采用、迁移或覆盖已有项目的文档体系；不提供 template upgrade/migration。
- 不要求所有外部项目使用该结构；`conventional | none | moye-doc-graph | custom` 既有 Policy 保持兼容。
- 不在 Moye 仓库或用户真实项目中运行脚手架验收；不发布 npm/Registry 新版本。
- 不新增 Runtime 状态或绕过 owning Workflow 的 Documentation Gate。
