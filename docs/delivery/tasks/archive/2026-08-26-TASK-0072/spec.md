# TASK-0072 Spec

> 状态：Approved
> Milestone：M2-W07
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

把 `moye@0.1.0` 构建为可从 npm tarball clean install 的消费级 CLI、Core/Client/Plugin SDK 子路径，并形成绑定 Git、npm 包、容器、Schema 与供应链清单的确定性 Release Candidate 产物。

## Requirements

- `REQ-0072-01`：npm 包只暴露 `moye` CLI 与 `moye/core | client | plugin-sdk`，内部 Runtime/Projection 写入口不可通过 exports 导入。
- `REQ-0072-02`：`npm pack` 只包含运行所需文件、Schema、License 与发布说明，不包含测试、Task Artifact、本机路径、Runtime 数据或 Provider Session。
- `REQ-0072-03`：隔离目录从 tarball 安装后可运行 CLI、读取三个公共子路径、初始化并验证外部 Git 项目。
- `REQ-0072-04`：Release Manifest 内容寻址绑定版本、Git Commit、tarball SHA-256、容器镜像 Digest、Schema/API/Plugin 版本和 channel；同版本不同内容拒绝。
- `REQ-0072-05`：生成 tarball checksum、License、CycloneDX SBOM 或等价机器可读依赖清单，并检查无绝对本机路径和私有 Runtime 数据。
- `REQ-0072-06`：CI 执行 check、E2E、pack clean-install、容器构建和 release verify；本地 RC dry-run 使用同一可重复入口。

## 非目标

- 本 Task 不向 npm、GitHub 或容器 Registry 写入；外部发布由 W10 在最终证据后执行。
- 本 Task 不宣称示例项目矩阵或跨版本升级已通过；分别由 W08/W09 交付。
