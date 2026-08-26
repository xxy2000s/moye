# Moye Package 与 Release Pipeline

> 文档类型：Runbook
> 状态：RC dry-run 已真实验证；外部 Registry 发布待 W10
> 更新日期：2026-08-26

## 1. 产品产物

首版使用单个 `moye@0.1.0` npm 包和同版本 Service 镜像。npm exports 仅包含：

- `moye/core`：Manifest Schema、版本和稳定错误；
- `moye/client`：消费级 Task Client；
- `moye/plugin-sdk`：Adapter 契约与 contract suite；
- `moye`：消费级 CLI；
- `moye/schemas/project.schema.json`：机器可读 Manifest Schema。

tarball 不分发 Restate Workflow handler、Projection reducer、测试、内部文档、Runtime 数据或 Provider Session。Service Runtime 继续通过 Docker 镜像分发。

## 2. 本地 RC 演练

对当前未提交实现做产品验收时，使用独立 clean Git snapshot；流水线不会把脏工作区 HEAD 冒充 Release Commit：

```bash
npm run acceptance:framework:release
```

入口会依次执行 snapshot commit、`npm ci`、`npm pack`、文件白名单审计、隔离 clean install、三个公共 exports、CLI init/validate、Docker build、CycloneDX SBOM、checksum 和 Release Manifest。默认输出到 `.moye-runtime/release/0.1.0-rc.1/`。

已提交且 clean 的候选版本可以直接执行：

```bash
MOYE_RELEASE_VERSION=0.1.0-rc.1 \
MOYE_RELEASE_IMAGE=moye:0.1.0-rc.1 \
npm run release:verify
```

`release:verify` 在 dirty worktree 上 fail closed。Release Manifest 绑定版本、channel、Git Commit、tarball SHA-256/npm integrity、容器 image ID、Schema/API/Plugin 版本和 SBOM Digest。

## 3. CI 与发布边界

`.github/workflows/ci.yml` 在 clean checkout 上执行仓库门禁、E2E 和完整 release dry-run，并上传本地候选产物。RC/GA 的 Git Tag、GitHub Release、npm publish 和容器 push 是 W10 的外部 Effect；缺少凭证时不得把本地 tarball 或 image ID 宣称为公开 Registry Receipt。

同一版本已经存在但目标 Digest 不同属于冲突，禁止覆盖 Tag、重复 publish 或复用版本。回执未知必须先从 Git/npm/Registry 查询版本和 Digest，再决定 CONFIRMED 或 NOT_APPLIED。
