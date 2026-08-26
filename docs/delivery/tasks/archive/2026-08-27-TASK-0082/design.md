# TASK-0082 Design

> 状态：Approved

公共命令选择 `moye init --docs standard`，以保持项目初始化入口唯一，同时让普通 `init` 的既有非批量行为不变。标准模式默认 dry-run；`--apply` 在同一次调用中先形成完整计划、发现冲突后再写。`--force` 与标准模式互斥，避免把 Manifest 的旧替换语义扩散到项目文档。

新增纯产品边界 `framework/documentation-scaffold.ts`。模板表按 portable relative path 排序，内容由 `templateVersion + projectId + targetRef` 唯一决定；计划先 realpath Git root，再逐段 `lstat` 拒绝 symlink，读取目标字节并分类。任何 conflict 都抛出携带完整计划的稳定错误；apply 使用 `wx`，并在并发占用时只接受相同字节，绝不覆盖。

`standard-docs-v1` 生成 `.moye/documentation-scaffold.json`，其 entries 绑定所有受管目标的 path/byteLength/SHA-256，不包含自身以避免自引用；Scaffold Manifest 自身另有 canonical digest。项目内 `scripts/docs_validate.mjs` 只读取该 allowlist，拒绝绝对/父级/反斜杠路径、symlink、缺失和 Digest 漂移。`.moye/project.yaml` 使用 custom argv `node scripts/docs_validate.mjs`，因此现有 Documentation Policy v1 可在 Candidate 上运行真实确定性 Gate，无需增加 Runtime command。

CLI 的内部/发布入口都调用同一 module。验收脚本只在 `mkdtemp` 仓库中运行 `npm pack` 安装形态、Git 与真实 Runtime Task；Moye repo 只提供构建输入和保存摘要，不接收脚手架产物。
