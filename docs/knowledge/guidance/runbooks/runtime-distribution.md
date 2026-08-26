# Moye Runtime Distribution 运维手册

> 文档类型：Runbook
> 状态：Start/restart/backup/restore 已真实验证；upgrade/rollback 具备确定性门禁，待 W09 跨版本矩阵复验
> 更新日期：2026-08-25

## 1. 适用范围

本手册操作 `compose.yaml` 中的 Restate、Moye Service 与一次性 registrar。它证明单机容器分发、持久化、备份和版本切换，不代表 HA、灾备、Auth/RBAC、多租户或生产 SLO。

默认安全边界：Board、Restate Ingress 和 Admin 都只绑定 `127.0.0.1`；Service Endpoint 只在 Compose 内部网络可见。不要把 Admin 或未鉴权的 Board 直接暴露到公网。

## 2. 首次启动

前置条件：Docker Engine、`docker compose` 插件或 `docker-compose`，以及可写的工作目录。

```bash
cp config/runtime.env.example .env
mkdir -p .moye-runtime/workspaces .moye-runtime/sessions
npm run runtime:config
npm run runtime:up
npm run runtime:status
curl --fail http://127.0.0.1:3000/healthz
curl --fail http://127.0.0.1:3000/readyz
```

`runtime:up` 构建或使用 `MOYE_IMAGE`，启动 Restate 与 Service，并在 Service 健康后由 registrar 向 Restate 注册 `http://moye:9080`。`/healthz` 只证明进程响应；`/readyz` 还探测 Restate Ingress 与 Admin health。

持久数据分开保存：

- `<compose-project>_restate_data`：Journal、Invocation、Projection；
- `<compose-project>_moye_artifacts`：Task Artifact、Session Evidence、Archive；
- `MOYE_WORKSPACE_ROOT`：显式挂载的外部 Git 项目工作区；
- `MOYE_SESSION_SOURCE_ROOT`：显式只读挂载的 Provider Session 来源。

Service 镜像包含固定版本 Codex/Claude CLI、Git、Ruby 与 Node。认证材料不会自动进入容器；需要真实 Agent 时由 Operator 以最小权限显式挂载 Provider 认证，并确保工作区 UID/GID 可写。Python 等项目工具链应通过派生镜像安装，不能假定基础 Service 镜像包含所有语言环境。

## 3. 日常操作

```bash
npm run runtime:status
npm run runtime:logs
npm run runtime:down
npm run runtime:up
```

`runtime:down` 只 stop 三个服务，不删容器、网络或卷；再次 `up` 必须能读取同一个 Runtime。`runtime:uninstall` 删除容器与网络但保留命名卷。不得用 `down -v` 代替日常停止。

## 4. 备份与恢复

一致性备份会停止 registrar、Service 和 Restate，在只读挂载下分别归档两个卷，写出 `runtime-backup.json` 与每个 tarball 的 SHA-256，最后重新启动并注册 Service：

```bash
npm run runtime:backup -- /absolute/path/to/backup-2026-08-25
```

恢复默认 fail closed，只接受内容摘要与 `RESTATE_NODE_NAME` 匹配的 manifest，并要求目标卷为空。node name 是 Restate 数据身份，不能在已有数据上用新的容器 hostname 代替。建议先用新的 Compose project 做恢复演练：

```bash
COMPOSE_PROJECT_NAME=moye_restore_drill \
MOYE_CONFIRM_RESTORE=RESTORE_RUNTIME_DATA \
npm run runtime:restore -- /absolute/path/to/backup-2026-08-25
```

恢复后检查 `/readyz`、历史 Task Trace、Board Archive 数量和一个只读 Task status。要覆盖原 project，必须先在外部保存并验证备份，再显式 purge 原数据；不要把 restore 当作合并两个 Runtime 的工具。

## 5. 升级与回滚

升级前必须固定非 `latest` 镜像并先备份：

```bash
npm run runtime:backup -- /absolute/path/to/pre-upgrade
MOYE_IMAGE=ghcr.io/example/moye:0.1.1 npm run runtime:upgrade
curl --fail http://127.0.0.1:3000/readyz
```

升级只重建 Service/registrar，不删除 Restate 或 Artifact 卷。Restate 会重试未确认调用；兼容版本必须保留既有 Workflow durable command 顺序，不能让已完成 Agent/Test/Commit 重跑。若新版本声明需要离线迁移而仓库没有对应迁移器，停止升级并回滚，不能直接改 Journal/Projection。

```bash
MOYE_IMAGE=ghcr.io/example/moye:0.1.0 npm run runtime:rollback
```

回滚后对比升级前 Task 的 Projection/Evidence Digest。版本相同但镜像 Digest 不同视为发布冲突。

## 6. 卸载与数据删除

非破坏性卸载：

```bash
npm run runtime:uninstall
```

只有确认已验证外部备份且目标 Compose project 精确无误时，才允许删除命名卷：

```bash
COMPOSE_PROJECT_NAME=moye \
MOYE_CONFIRM_PURGE=DELETE_RUNTIME_DATA \
npm run runtime:purge-data
```

`purge-data` 不可恢复；不要对未知 project、通配符卷名或共享环境执行。

## 7. 故障定位

1. `/healthz` 失败：检查 Service container 和 `runtime:logs`；
2. `/healthz` 成功但 `/readyz` 失败：检查 Restate container、内部 DNS 和 Admin `/health`；
3. registrar 非零退出：读取 registrar logs，不重复提交 Task；注册本身对相同 endpoint 可对账；
4. 重启后 Task 缺失：检查是否使用同一 `COMPOSE_PROJECT_NAME` 与 `restate_data` 卷，禁止扫描 Git Archive 补造 Projection；
5. Artifact 缺失：核对 `moye_artifacts` 卷、manifest Digest 和挂载权限；
6. 真实 Agent 不可用：检查容器内 CLI、显式认证挂载、Session allowlist、工作区权限和项目工具链。
