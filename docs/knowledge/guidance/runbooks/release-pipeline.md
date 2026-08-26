# Moye Package 与 Release Pipeline

> 文档类型：Runbook
> 状态：0.1.0 GA pipeline 与发布对账已实现；公开渠道以 Receipt 为准
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

## 3. GA 构建

GA 只能从 Sealed Task 的唯一 clean Result Commit 构建：

存在多组本地隧道时，先显式选择包含前置任务的 canonical Runtime；不要依赖 CLI 默认端口：

```bash
RESTATE_INGRESS_URL=http://127.0.0.1:50889 \
RESTATE_ADMIN_URL=http://127.0.0.1:50890 \
npm run cli -- seal-status TASK-0074
```

只有前置 Task 返回 `CLOSED + ARCHIVED` 才能向同一组端点启动 W10 Seal。不同 Restate cluster 的同名 Workflow 不共享 Journal 或 Projection，禁止复制数据库或用 Git 目录补画 Runtime 状态。

```bash
MOYE_RELEASE_TASK_ID=TASK-0075 \
MOYE_RELEASE_VERSION=0.1.0 \
MOYE_RELEASE_IMAGE=ghcr.io/xxy2000s/moye:0.1.0 \
MOYE_RELEASE_OUTPUT=.moye-runtime/release/0.1.0 \
npm run release:verify
```

输出必须包含 `moye-0.1.0.tgz`、`checksums.txt`、`sbom.cdx.json`、`release-manifest.json` 和 clean-install `evidence-summary.json`。`gitCommit` 必须等于当前 clean HEAD，container reference 必须使用不可变版本标签。

## 4. 外部发布与对账

```bash
MOYE_RELEASE_TASK_ID=TASK-0075 \
MOYE_RELEASE_OUTPUT=.moye-runtime/release/0.1.0 \
MOYE_RELEASE_IMAGE=ghcr.io/xxy2000s/moye:0.1.0 \
npm run release:publish
```

命令先写不可变 `publish-intent.json`，再按 Git Tag、GitHub Release、npm、container 顺序查询目标端；观测追加到 `publish-events.jsonl`，摘要写入 `publish-summary.json`。重复执行同一 Intent 只对账并复用相同内容；`CONFLICT` 非零失败，`BLOCKED_AUTH` 与 `UNKNOWN` 保留为未公开状态。需要所有渠道都确认的自动门禁可追加 `-- --require-all`。

## 5. CI 与发布边界

`.github/workflows/ci.yml` 在 clean checkout 上执行仓库门禁、E2E 和完整 release dry-run，并上传本地候选产物。Git Tag、GitHub Release、npm publish 和容器 push 是独立外部 Effect；缺少凭证时不得把本地 tarball 或 image ID 宣称为公开 Registry Receipt。

同一版本已经存在但目标 Digest 不同属于冲突，禁止覆盖 Tag、重复 publish 或复用版本。回执未知必须先从 Git/npm/Registry 查询版本和 Digest，再决定 CONFIRMED 或 NOT_APPLIED。

安装、升级、迁移与回滚见 [Framework 安装、升级与迁移](./framework-migration.md)，安全默认值和未实现的生产隔离见仓库根 [SECURITY.md](../../../../SECURITY.md)。
