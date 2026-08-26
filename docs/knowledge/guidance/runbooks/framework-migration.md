# Framework 安装、升级与迁移

> 文档类型：Runbook
> 状态：0.1.0 GA procedure
> 更新日期：2026-08-26

## 1. 安装来源与身份

优先使用 Registry 中已由 `publish-summary.json` 标记 `CONFIRMED` 的不可变版本。Registry 未发布时可以使用 GA 目录或 GitHub Release 中的 tarball，但必须先核对 `checksums.txt`、`release-manifest.json` 的 `gitCommit`、npm integrity、image digest 和 `releaseDigest`。

```bash
shasum -a 256 -c checksums.txt
npm install --save-dev ./moye-0.1.0.tgz
npx moye --help
```

不要使用 `latest`、可变容器标签或来源不明的本地 image ID 替代版本化身份。

## 2. 新项目接入

```bash
npx moye init --dir . --project-id my-project
npx moye project validate --file .moye/project.yaml
npx moye doctor --file .moye/project.yaml
```

提交前检查 `.moye/project.yaml` 中的 repository、target ref、Agent Runner、argv-only Trusted Test、Documentation Policy 与 Artifact 策略。默认不会上传 Prompt、源码或 Provider Session。

## 3. 0.1.x 升级

1. 记录当前 Git Tag、npm version、容器 immutable reference 和 Runtime `/healthz` release identity；
2. 运行 `npm run runtime:backup` 并保存 backup manifest；
3. 验证新版本 Project Schema/API/Plugin API；
4. 使用固定 image reference 执行 `MOYE_IMAGE=<registry>/moye:<version> npm run runtime:upgrade`；
5. 检查 Service readiness、Restate deployment、运行中 Task 和至少一个已归档 Task 的 Projection Digest；
6. clean install 对应 npm/tarball，执行 CLI/exports/Schema smoke。

Project Manifest Schema v1 不需要迁移。未来 schema 变化必须通过显式 migration 命令或稳定错误码处理，不允许静默改写配置。运行中 Workflow 若无法兼容，必须停在明确的 migration/reconcile 状态，禁止重建 Task 或重跑 Agent/Test/Merge。

## 4. 回滚

回滚只使用已经验证的固定旧 image：

```bash
MOYE_IMAGE=<registry>/moye:0.1.0 npm run runtime:rollback
```

回滚后复核 `/healthz`、TaskAuthority、运行中 Workflow、归档 Projection 与 Artifact 可读性。Archive 数据和历史 Session Evidence 不做就地降级或改写。

## 5. 发布对账

从 sealed clean Commit 构建 GA 后执行：

```bash
MOYE_RELEASE_OUTPUT=.moye-runtime/release/0.1.0 \
MOYE_RELEASE_IMAGE=ghcr.io/xxy2000s/moye:0.1.0 \
npm run release:publish
```

入口先持久化不可变 `publish-intent.json`，再逐项查询 Git Tag、GitHub Release、npm 与容器 Registry；事实追加到 `publish-events.jsonl`，当前摘要写入 `publish-summary.json`。`CONFIRMED` 才代表目标端内容匹配；`BLOCKED_AUTH`、`UNKNOWN` 或 `CONFLICT` 都不是发布成功。回执未知时重复运行同一命令只做对账，不得更改 version、tag 或 digest。
