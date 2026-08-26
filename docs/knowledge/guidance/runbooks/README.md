# Runbooks

Runbook 描述已经实际执行并验证的启动、恢复、排障和清理步骤。Architecture 负责设计，Runbook 不定义新的状态机。

## 当前 Runbook

- [Moye Runtime Distribution 运维手册](./runtime-distribution.md)：完整 Service+Restate Compose 的启动、健康、日志、备份、恢复、升级、回滚、卸载与显式数据清理。
- [Moye Package 与 Release Pipeline](./release-pipeline.md)：npm tarball、公共 exports、clean install、容器、SBOM、Release Manifest 与 RC/GA 副作用边界。
- [本地运行 Restate PoC](./local-restate-poc.md)：安装、启动、注册、CLI、Board、故障注入和清理。

未经验证的命令只放在 Task Plan 或 Proposed Architecture，不能提升为 Runbook。
