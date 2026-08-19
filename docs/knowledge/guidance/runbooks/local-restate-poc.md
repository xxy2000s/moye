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

等待终端打印 `Moye demo 已就绪`，然后打开终端中 `项目看板:` 后面的动态 URL：

1. 看 Backlog 列中的需求来源；
2. 看 Archived 列中的已完成 Task；
3. 点击 Task 卡片，查看 `TaskCreated → TaskExecuting → TaskVerifying → TaskClosed → ArchivePending → ArchiveArchived`；
4. 按 `Ctrl-C` 停止本地服务。

脚本只管理名为 `moye-restate-demo` 的容器，不删除其他容器；运行数据保存在 `.moye-runtime/demo`。

## 2. 自动验收

Docker daemon 可用时，以下命令会启动隔离容器、注册服务、提交 Task、强杀 Worker、重启、验证结果并自动清理：

```bash
npm install
npm run check
npm run test:e2e
```

成功标准：单元测试 12 项和 E2E 2 项通过；E2E 分别验证进程中断恢复，以及 Pipeline 重试耗尽后 `FAILED_TERMINAL` 并继续归档失败证据。

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
```

- `create` 异步提交 keyed Workflow；
- `close` 连接同一 Workflow 并等待业务终态，不创建第二条流程；
- `archive` 和 `reconcile` 连接同一 keyed ArchiveWorkflow。

打开 `http://127.0.0.1:3000` 查看 Moye Board；打开 `http://127.0.0.1:9070` 或使用 Admin API 排查 Restate Invocation。二者都通过 `task_id` 关联。

## 5. 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MOYE_PROJECT_ID` | `moye` | Board Projection key |
| `RESTATE_INGRESS_URL` | `http://127.0.0.1:8080` | CLI/Board 查询与命令入口 |
| `RESTATE_SERVICE_PORT` | `9080` | Restate Service Endpoint |
| `MOYE_BOARD_PORT` | `3000` | Board HTTP Server |

## 6. 故障判读

- Service 退出但 Restate 仍运行：重启 `npm run dev`，未确认步骤会恢复；
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
