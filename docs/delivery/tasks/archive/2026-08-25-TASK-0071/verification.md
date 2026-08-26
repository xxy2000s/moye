# TASK-0071 Verification

> 状态：Accepted
> 产品证据：[runtime-distribution-acceptance.json](./runtime-distribution-acceptance.json)

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0071-01 | `docker-compose up --build`；`docker image inspect`；容器内 `codex --version` / `claude --version` | 最终验收镜像 `sha256:0a45cf…2671`；镜像配置 `User=node`；Codex 0.149.1、Claude Code 2.1.104 |
| REQ-0071-02 | `docker-compose config`；真实 Restate+Moye+registrar 启动 | Board/Ingress/Admin 仅 loopback，9080 未发布；registrar ExitCode 0 |
| REQ-0071-03 | 真实 Task → `runtime:down` → `runtime:up` | `TASK-RUNTIME-1787702994174` 三个时点 Projection Digest 均为 `sha256:a8ff1b…1e73` |
| REQ-0071-04 | `/healthz`、`/readyz` 与依赖失败单测 | liveness 200；Ingress 可达、Admin `/health` 200 时 readiness 200；依赖失败返回 not_ready |
| REQ-0071-05 | `docker-compose config`、配置模板、镜像检查 | 路径/端口/采集均显式；敏感采集默认 false；非 root 运行 |
| REQ-0071-06 | runtime operation/backup 单测；真实 backup/restore drill | 普通 stop/uninstall 不删卷；purge/restore 双确认；双 tar SHA-256 验证；稳定 `RESTATE_NODE_NAME` |
| REQ-0071-07 | `npm run acceptance:framework:runtime`（自动包含跨 project restore drill） | 容器内真实 Task 唯一归档；backup 后重启不变；恢复到 `moye_rt_31768_restore` 后同一 Task/Digest 可查询 |

## Repository Gates

- `npm run check`：52 个 Test File、295 个 Test 全通过；Document Graph 650 docs / 985 relations / 420 Markdown；
- `npm run test:e2e`：13 files passed、2 skipped；35 tests passed、2 skipped；
- `docker-compose config`：通过；
- `npm run acceptance:framework:runtime`：真实镜像、部署注册、Task、stop/start、双卷 backup 通过；
- 同一自动化入口恢复到新 Compose project：readiness ready、registrar ExitCode 0、Task `CLOSED + ARCHIVED + SUCCEEDED`、Digest 不变；
- 验收临时 containers、networks、volumes 均按精确 project 清理；保留内容寻址证据和本地验证镜像。

## Finding Disposition

- `BL-0075`：一次性 registrar 应用 `compose ps -a` 查询，已修复并复验；
- `BL-0076`：Restate node name 必须稳定并进入 backup manifest，已修复并通过跨 project restore；
- upgrade/rollback 的固定镜像门禁已实现，真正的旧版本运行中 Task 跨版本恢复由 W09 产品矩阵继续验证，不在本 Task 冒充完成。
