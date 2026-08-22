# 本地运行 Restate PoC

> 状态：Verified  
> 验证日期：2026-08-22
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
3. 点击 Task 卡片进入居中的 Task Audit Workspace；默认不显示详情侧栏，先在完整画布中核对当前业务/Archive 状态和 `Projection = Event History` 一致性；
4. 在状态机 Graph 中先选择“本次点亮”，核对粗实线实际路径与当前节点；再切换“恢复/回滚”“异常/失败”“归档”，确认 Repair、Replan、Reconcile、失败和 Archive 合法边完整存在；
5. 点击任一节点，在 Inspector 中依次核对“实际状态事件”“执行实例与 Agent”“系统管控与结果”：Event 必须带 sequence/type/time，执行卡必须带 kind、状态、Generation、ID、Session、耗时和 Evidence；有 Session 的卡片应能直接打开对应 Chatbot Events，VERIFY 应显示命令与退出码，WORKSPACE/MERGE 应显示 Git Effect，失败或 Reconcile 节点应显示恢复判断和动作；
6. 对本次未经过的节点，确认页面明确显示零 Event、零执行实例且不出现虚构 Session/Evidence。桌面详情出现在画布右侧，窄屏详情从底部展开；关闭按钮或 `Esc` 只收起节点详情并把焦点还给节点。展开“实际路径”可再次核对转换文本事实；使用放大、缩小或“适配”查看画布；
7. 只有排障时再展开“高级诊断”。其中的链接会在 Restate 中按当前 `task_id` 精确过滤；
8. 按 `Ctrl-C` 停止本地服务。

Demo 使用隔离 Git Fixture 和确定性 Fake Agent，不修改 Moye 仓库。脚本只管理名为 `moye-restate-demo` 的容器，不删除其他容器；运行数据保存在 `.moye-runtime/demo`。

使用真实本机 CLI 时运行 `npm run demo:codex` 或 `npm run demo:claude`。脚本仍只操作隔离 Fixture，并在 Workflow 发出请求后立即打印看板 URL；打开进行中的 Task，每条 Context、Implementation、Self Review、Review、Replan 与 Docs Gate Session 都可在同一个 Chatbot Dialog 中查看。页面显示 Role、Session、Attempt 与 Runner，支持全部/对话/工具调用/工具结果/系统/错误筛选并实时增长；完成后才开放摘要校验的原始 JSONL 导出。命令复用本机已有认证，不修改用户级 Settings。

### 带 Trace 的可选体验

```bash
npm run demo:trace
```

首次运行会拉取 Phoenix 镜像。命令启动可选 Phoenix Profile 后再启动同一个 Demo；终端会同时打印动态 Moye Board URL、动态 Restate URL 和固定的 Phoenix URL `http://127.0.0.1:6006`。在 Moye 已归档 Task 中复制 Trace ID，再打开 Phoenix 查询；点击任一 Session 的“在弹窗查看对话”后，事件在独立 Chatbot Dialog 中呈现，不会打开新页面或默认下载。每条消息可下钻原始 JSON；需要保存完整证据时再导出原始 JSONL。关闭后仍停留在同一 Task Detail，焦点返回原 Session 按钮。检查后停止前台 Demo，并运行：

```bash
npm run trace:status
npm run trace:down
```

`trace:down` 删除本项目 Phoenix 容器和网络，但保留命名数据卷，避免误删诊断数据。普通 `npm run demo` 完全不依赖 Phoenix。

## 2. 自动验收

Docker daemon 可用时，以下命令会启动隔离容器、注册服务、提交 Task、强杀 Worker、重启、验证结果并自动清理：

```bash
npm install
npm run check
npm run test:e2e
npm run acceptance:live
```

`npm run acceptance:live` 是产品可用性门禁：它先确认页面 API 拒绝 Fake，再通过统一 CLI 在隔离临时 Git 仓库提交真实 Coding Task，依次调用真实 Codex Context、Implementation、Self Review、独立 Review 与 Docs Gate Session，随后验证命令、唯一 Merge、CLI wait、Board Closure 与 Archive。它会消耗真实模型额度；常规单元/E2E 仍可使用确定性 Fixture 验证恢复语义。

当前成功标准：全部单元测试与类型检查通过，真实 Restate E2E 覆盖归档恢复、Backlog 同步、唯一 Merge、事件流、Trace、Verification 失败、未知结果对账与 Worker 重启；Live Acceptance 另外证明页面产品路径没有用 Fake/Mock 冒充成功。

TASK-0011 已通过 `npm run demo:codex` 再次执行真实 Codex 隔离 Fixture：运行中事件从 4 条增长至 13 条，完成时冻结 17 条，包含命令执行、文件修改、Git Commit、工具结果和最终回答，并通过 Verification、唯一 Merge 与 Archive。自动化回归仍使用 Fake/受控进程，避免每次测试消耗模型额度。

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
MOYE_REPOSITORY_ROOTS=/absolute/path/to/allowed/repo \
MOYE_LIVE_RUNTIME_ROOT=/absolute/path/outside/repo/moye-live \
npm run dev
```

Board 是只读审计面，不提供状态写入口。通用 Task 和真实编码任务都可使用下节统一 CLI 提交；页面 `POST /api/tasks` 与 CLI 复用同一 `buildLiveCodingTask`。目标分支不存在时会从 Base 自动创建；目标分支已被任一 Worktree 检出、不是 Git ref、或 Runtime Root 位于目标仓库内时，请求会在进入 Runtime 前失败。产品输入只接受 `CODEX_EXEC | CLAUDE_PRINT`，拒绝 Fake。

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

`create` 自动识别两类 JSON：含 `objective`、`repositoryRoot`、`runnerKind` 的输入是产品 Coding Task Submission；否则按兼容的 `TaskWorkflowInput` 校验。常用操作：

```bash
npm run cli -- validate --file /path/to/task.json
npm run cli -- create --file /path/to/task.json
npm run cli -- status TASK-EXAMPLE
npm run cli -- wait TASK-EXAMPLE --timeout-ms 900000
npm run cli -- close --file /path/to/task.json
npm run cli -- backlog sync --dir docs/delivery/backlog --project moye
```

- `create` 异步提交 keyed owning Workflow；`status/wait` 先解析 TaskAuthority，不会把 Coding Task 错查到 TaskWorkflow；
- `wait` 在成功/失败 Archive 终态、Archive 失败或 `WAITING_RECONCILE` 返回；不会创建第二个 Invocation；
- `close` 连接同一 Workflow 并等待业务终态，不创建第二条流程；
- `archive` 和 `reconcile` 连接同一 keyed ArchiveWorkflow。
- `backlog sync` 在提交前校验完整 YAML 批次；重复同步按 Source Digest 收敛；运行时独有记录默认保留并报告。
- `CodingTaskWorkflow/<task_id>` 接受冻结 Envelope 和真实 Runner 配置；产品链是 Context → Worktree → Implementation → Self Review → Verification → independent Review → Repair/Replan → Merge → Docs Gate → Closure → Archive。Blocking Finding 的 `REPAIR` 创建新 Generation，`REPLAN` 创建 Spec Revision N+1；主状态、全部 Session 与事件摘要同步到 Board。
- `CoreClosureWorkflow/<task_id>` 接受冻结 Envelope、确定性场景和受管 Artifact Root；它当前是 Core 收敛 PoC/API，不会投影到 Board，也不替代 Coding Workflow。

Core Workflow 的只读状态可直接从 Restate Ingress 查询：

```bash
curl -sS -X POST http://127.0.0.1:8080/CoreClosureWorkflow/TASK-EXAMPLE/status \
  -H 'content-type: application/json' \
  --data 'null'
```

返回 `EXECUTING` 表示 Scenario Effect 尚未确认；`CLOSED` 必须同时带唯一 `outcome`、`closureDigest`、`sourceProjectionDigest` 和 Artifact 引用。不要把空 status 当作失败终态，也不要因查询超时提交另一个 Workflow key。六场景和强杀恢复的可重复验收命令是：

```bash
npx vitest run tests/e2e/core-closure-workflow.test.ts
```

直接查询 Coding Trace：

```bash
curl http://127.0.0.1:3000/api/tasks/TASK-EXAMPLE/trace
```

响应中的 `stateMachine.history` 是 Event 证明的实际路径，`stateMachine.definition.edges` 是代码允许的路径，两者不能混用；`current.consistency` 必须为 `VERIFIED`。`roles/agents/reviews/specRevisions` 列出全部真实会话和规格版本；`durableRuntime.workflowRef` 用于定位 Journal；`technical.artifacts` 只提供日志和证据引用。除 `WAITING_RECONCILE` 外，`recovery` 都是只读建议；等待对账时按 Trace 中 token 执行：

```bash
npm run cli -- reconcile-task TASK-EXAMPLE \
  --token 'coding-reconcile:sha256:...' \
  --evidence '已核对 execution intent、manifest 或 Git ref 的外部证据位置'
```

该命令只解析当前 durable promise，让原 operation 再对账；Evidence 未准备好时不得调用，也不能借此创建新 Attempt。通用 Task 的同一路径返回 `traceKind: TASK` 和状态机 History。

`observability.enabled` 只表示当前 Moye 进程已配置 OTLP，不代表 Task 状态成功，也不替代后端健康检查。`observability.traceId` 是稳定查询键；当前 Implementation 使用 `/agent-events?cursor=<n>&limit=<1..200>`，当前 Context/Self Review/Replan/Review/Docs Gate 使用 `/roles/<run-id>/events?cursor=<n>&limit=<1..200>`。两者只从 Projection locator 解析 Run，运行中校验 execution intent 与路径，完成后原始下载再校验大小和摘要。Task 声明的 Artifact Root 必须位于 `MOYE_ARTIFACT_ROOTS` 内。

打开 `http://127.0.0.1:3000` 查看 Moye Board。普通使用只需要 Moye；需要确认 Invocation、Journal 或 Replay 时，再从任务的“高级诊断”进入 `http://127.0.0.1:9070` Restate UI。二者通过 `task_id` 关联，但 Restate UI 不是项目任务看板。

## 5. 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MOYE_PROJECT_ID` | `moye` | Board Projection key |
| `RESTATE_INGRESS_URL` | `http://127.0.0.1:8080` | CLI/Board 查询与命令入口 |
| `RESTATE_ADMIN_URL` | `http://127.0.0.1:9070` | 看板 Trace 中的 Restate Admin 定位入口 |
| `RESTATE_SERVICE_PORT` | `9080` | Restate Service Endpoint |
| `MOYE_BOARD_PORT` | `3000` | Board HTTP Server |
| `MOYE_ARTIFACT_ROOTS` | 空 | 允许 Board 下载 Agent Artifact 的受管根；多个路径按平台 path delimiter 分隔 |
| `MOYE_REPOSITORY_ROOTS` | 当前工作目录 | 页面允许提交的 Git 仓库根；多个路径按平台 path delimiter 分隔 |
| `MOYE_LIVE_RUNTIME_ROOT` | `.moye-runtime/live` | 页面任务的 Task Package、Artifact 与 Worktree 受管根；必须位于目标仓库之外 |
| `MOYE_OBSERVABILITY_ENABLED` | `false` | 开启 Moye OTLP Trace 导出 |
| `MOYE_OTLP_TRACES_ENDPOINT` | `http://127.0.0.1:6006/v1/traces` | OTLP/HTTP protobuf traces endpoint |
| `MOYE_TRACE_UI_URL` | `http://127.0.0.1:6006` | Board 显示的诊断 UI 入口 |
| `MOYE_TRACE_SERVICE_NAME` | `moye` | OTel service name |
| `MOYE_TRACE_PROJECT_NAME` | `moye` | Phoenix/OTel project name |
| `MOYE_CLAUDE_NATIVE_TELEMETRY` | `false` | 只为当前 Claude 子进程注入原生 OTel 环境 |
| `MOYE_CAPTURE_USER_PROMPTS` | `false` | 允许 Claude 遥测记录用户 Prompt（敏感） |
| `MOYE_CAPTURE_ASSISTANT_RESPONSES` | `false` | 允许 Claude 遥测记录回答（敏感） |
| `MOYE_CAPTURE_TOOL_DETAILS` | `false` | 允许记录工具详情 |
| `MOYE_CAPTURE_TOOL_CONTENT` | `false` | 允许记录工具输入输出内容（敏感） |
| `MOYE_CAPTURE_RAW_MODEL_IO` | `false` | 允许 Claude 把 Raw API Body 写入当前 Attempt Artifact（高度敏感） |

所有内容采集开关彼此独立且默认关闭。Moye 只把这些变量传给本次 `claude -p --output-format stream-json` 子进程，不编辑 `~/.claude/settings.json` 或 Codex 配置。CLI 版本不支持某个原生变量时，该层数据不会出现；Moye 自己从 Projection 导出的 Trace 和 CLI stream JSONL 仍可用。升级前先执行 `claude --version` / `codex --version`，并用本节 Demo 验证，不要假设不同版本字段相同。

可见性边界：Moye Trace 能看到 Task、Step、Attempt、Agent Run、状态和耗时；Codex 只保证保存 CLI 暴露的 `--json` JSONL，无法承诺未暴露的原始 HTTP Request/Response Body；Claude 保存 `stream-json`，启用原生 OTel 后可增加其 CLI 提供的 Span/Metric。只有显式开启内容或 Raw Body 变量时才可能看到模型正文，开启前应把本地 Phoenix 和 Artifact 按敏感数据处理。

`MOYE_TEST_FAULT_INJECTION=enabled` 只允许自动化测试子进程开启 Git 或 Core Artifact 强杀/丢回执注入。正常开发、演示和部署不要设置它；未显式开启时，带 `fault` 的 Coding/Core Workflow 会在执行副作用前被拒绝。

## 6. 故障判读

- Service 退出但 Restate 仍运行：重启 `npm run dev`，未确认步骤会恢复；
- Coding Trace 的 Projection state 是 `WAITING_RECONCILE`：先用 `workflowRef` 检查 Journal并核对稳定 Intent、Artifact 或 Git Effect marker；只有外部证据已确认时才用当前 token 发送 `reconcile-task`，不能盲目重跑；
- Coding Trace 显示 `FAILED_TERMINAL`：失败 Attempt 会继续进入 Archive 固化；修复需求后创建新 Task，不要复活旧 Attempt；Workflow 内的合法 Replan 只能在失败终态前由 Finding 触发；
- Review 返回 Blocking Finding：Workflow 会在预算内启动新的 Agent Run Repair；Repair 后仍有 Blocking Finding 时任务失败且不会 Merge，不要手工改写 Verdict；
- Agent 修改完成但 `git commit` 报 `index.lock: Operation not permitted`：确认运行版本的 Codex argv 包含 `--add-dir <validated workspaceGitCommonDir>`；不要改成 `danger-full-access`，也不要把整个父目录加入白名单；
- Coding Trace 显示 `ARCHIVE_RETRY`：业务已关闭，只重新附着同一 ArchiveWorkflow，不重新编码；
- Core status 停在 `EXECUTING` 且 Service 曾退出：保持同一 `task_id` 和 Artifact Root 重启 Service，让 Restate 重放；若只存在 Scenario Intent 而没有结果，按 UNKNOWN 对账，不能删除 Intent 后盲目重跑；
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
