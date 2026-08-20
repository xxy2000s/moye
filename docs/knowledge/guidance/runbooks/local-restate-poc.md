# 本地运行 Restate PoC

> 状态：Verified  
> 验证日期：2026-08-20  
> 适用版本：Node.js 22、Restate SDK 1.16.7、Restate Server 1.7.4

## 1. 第一次体验

只需要 Node.js 22 和 Docker Desktop：

```bash
npm install
npm run demo
```

等待终端打印 `Moye Coding Demo 已就绪`，然后打开终端中 `项目看板:` 后面的动态 URL：

1. “需求池”显示需求来源及其派发状态；
2. “已归档”显示闭环完成的 Coding Task；
3. 点击 Task 卡片，先看任务结论与 `Task → Workflow → Agent Session → Git Commit` 关联链；
4. 依次展开“需求与上下文、隔离工作区、Agent 编码、自动验证、合入分支、文档检查、归档”，查看各阶段 Attempt 和 Evidence；
5. 只有排障时再展开“高级诊断”。其中的链接会在 Restate 中按当前 `task_id` 精确过滤；
6. 按 `Ctrl-C` 停止本地服务。

Demo 使用隔离 Git Fixture 和确定性 Fake Agent，不修改 Moye 仓库。脚本只管理名为 `moye-restate-demo` 的容器，不删除其他容器；运行数据保存在 `.moye-runtime/demo`。

## 2. 自动验收

Docker daemon 可用时，以下命令会启动隔离容器、注册服务、提交 Task、强杀 Worker、重启、验证结果并自动清理：

```bash
npm install
npm run check
npm run test:e2e
```

当前成功标准：单元测试 84 项和 E2E 10 项通过；除归档恢复与 Backlog 同步外，E2E 还覆盖一键 Coding Demo、Fake Coding Workflow 的唯一 Merge、重复命令拒绝、Agent 异常退出、Verification 失败不合并、Merge 丢回执对账、Git 更新后 Worker 退出恢复，以及 Verification 期间 Worker 重启不重复命令。单元测试另外证明 Workspace/Agent/Merge 的 UNKNOWN 全部保留结构化错误并要求先对账，以及静态文件符号链接不能逃出 `publicRoot`。

TASK-0006 的 `scripts/codex_fixture_smoke.mjs` 已执行一次真实 Codex 临时 Fixture，并把冻结证据存入对应 Task Archive。脚本会拒绝覆盖既有 `summary.json`，不属于日常回归命令；自动化测试只使用 Fake/受控进程。

## 3. 手工启动

启动 Restate：

```bash
docker run --rm --name moye-restate \
  -p 8080:8080 -p 9070:9070 \
  docker.restate.dev/restatedev/restate:1.7.4
```

另一个终端启动 Moye：

```bash
npm install
npm run dev
```

注册 HTTP/2 Service Endpoint：

```bash
curl -X POST http://127.0.0.1:9070/deployments \
  -H 'content-type: application/json' \
  -d '{"uri":"http://host.docker.internal:9080"}'
```

Linux Docker 中 `host.docker.internal` 不可用时，需要把 Restate 与 Moye 放入同一 Docker network，或将可从容器访问的宿主地址写入 `uri`。

## 4. CLI 与 Board

查看命令：

```bash
npm run cli -- --help
```

Task 输入是与 `TaskWorkflowInput` 对齐的 JSON。常用操作：

```bash
npm run cli -- validate --file /path/to/task.json
npm run cli -- create --file /path/to/task.json
npm run cli -- status TASK-EXAMPLE
npm run cli -- close --file /path/to/task.json
npm run cli -- backlog sync --dir docs/delivery/backlog --project moye
```

- `create` 异步提交 keyed Workflow；
- `close` 连接同一 Workflow 并等待业务终态，不创建第二条流程；
- `archive` 和 `reconcile` 连接同一 keyed ArchiveWorkflow。
- `backlog sync` 在提交前校验完整 YAML 批次；重复同步按 Source Digest 收敛；运行时独有记录默认保留并报告。
- `CodingTaskWorkflow/<task_id>` 接受冻结 Envelope 和 Fixture/Codex Runner 配置；主状态与事件摘要同步到 Board，点击 Coding Task 卡片可以查看 Attempt/Evidence、Journal 定位和技术日志分层 Trace。

直接查询 Coding Trace：

```bash
curl http://127.0.0.1:3000/api/tasks/TASK-EXAMPLE/trace
```

响应中的 `business` 才是业务状态事实；`durableRuntime.workflowRef` 用于定位 Journal，`durableRuntime.invocationsUrl` 是按 Workflow 服务和 Task key 过滤的 Restate 深链；`technical.artifacts` 只提供日志和证据引用。`recovery` 是从 Projection 派生的只读建议，不是新的控制命令。

打开 `http://127.0.0.1:3000` 查看 Moye Board。普通使用只需要 Moye；需要确认 Invocation、Journal 或 Replay 时，再从任务的“高级诊断”进入 `http://127.0.0.1:9070` Restate UI。二者通过 `task_id` 关联，但 Restate UI 不是项目任务看板。

## 5. 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MOYE_PROJECT_ID` | `moye` | Board Projection key |
| `RESTATE_INGRESS_URL` | `http://127.0.0.1:8080` | CLI/Board 查询与命令入口 |
| `RESTATE_ADMIN_URL` | `http://127.0.0.1:9070` | 看板 Trace 中的 Restate Admin 定位入口 |
| `RESTATE_SERVICE_PORT` | `9080` | Restate Service Endpoint |
| `MOYE_BOARD_PORT` | `3000` | Board HTTP Server |

`MOYE_TEST_FAULT_INJECTION=enabled` 只允许自动化测试子进程开启 Git 强杀/丢回执注入。正常开发、演示和部署不要设置它；未显式开启时，带 `fault` 的 Coding Workflow 会在任何 Git 操作前被 403 拒绝。

## 6. 故障判读

- Service 退出但 Restate 仍运行：重启 `npm run dev`，未确认步骤会恢复；
- Coding Trace 显示 `WAIT_OR_RECONCILE`：先用 `workflowRef` 检查 Journal；涉及 Verification/Agent/Git 未知结果时先核对稳定 Intent、Artifact 或 Git Effect marker，不能盲目重跑；
- Coding Trace 显示 `FAILED_TERMINAL`：保留失败 Attempt，修复需求后创建新 Task 或新 Spec Revision，不要复活旧 Attempt；
- Coding Trace 显示 `ARCHIVE_RETRY`：业务已关闭，只重新附着同一 ArchiveWorkflow，不重新编码；
- source 不存在、target 存在：Archive Reconcile 将其识别为已移动；
- source/target 都存在且摘要不同：不要删除任何一端，记录冲突并人工判定；
- Restate 返回 `META0014`：Service Endpoint 不是 HTTP/2；当前 `src/index.ts` 已使用 HTTP/2，不要改回普通 `node:http`；
- Board 显示 Runtime unavailable：先检查 Ingress `8080`，再检查 deployment 是否已注册；
- SDK 警告未验证请求签名：PoC 只能在受限本地网络运行，不能暴露公网。

## 7. 清理

前台容器使用 `Ctrl-C` 退出。后台启动时只删除明确命名的本地 PoC 容器：

```bash
docker stop moye-restate
```

不要删除未知容器、Docker volume 或整个工作区。
