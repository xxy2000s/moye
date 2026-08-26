# TASK-0072 Design

> 状态：Approved

包保持 ADR-0008 冻结的单一 umbrella identity。`package.json.exports` 是唯一公开模块边界：三个 `src/public/*` facade 只重导出版本化公共类型和操作，Service/Restate 内部模块即使存在于运行镜像，也不进入 npm `files` 或 exports。

发布流水线分为 build、pack audit、clean install、container build、release manifest 五个确定性阶段。每个阶段保留 argv、退出码和内容摘要；最终 Manifest 使用 canonical JSON 生成 identity digest，并拒绝同版本不同 digest。RC dry-run 不执行外部 publish effect。

发布包使用独立 `tsconfig.build.json`，避免把 tests/scripts 编译进 npm 产物。CLI 仍由同一包提供，运行时 Compose/Docker 分发保持 W06 的独立容器边界。
