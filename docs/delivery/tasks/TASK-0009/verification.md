# TASK-0009 Verification

> 状态：Accepted
> Spec Revision：1  
> 验证日期：2026-08-21
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）

## 验收映射

| Requirement | 证据 | 结果 |
|---|---|---|
| REQ-0009-01 | `telemetry.test.ts` 证明稳定 Trace/Span ID、Attempt/Agent 父子关系、标准 OTLP/protobuf 与默认 Noop；Projection 只生成短 Span | Pass |
| REQ-0009-02 | Codex/Claude unit 证明 argv-only、`shell:false`、stream-json 解析、进程级 OTel、内容默认关闭、Raw API 受管目录与符号链接拒绝 | Pass |
| REQ-0009-03 | `npm run demo:trace` 启动 Phoenix 19.10.0；真实 Demo Trace 被项目 `moye-demo` 接收，关闭/健康操作已写入 Runbook | Pass |
| REQ-0009-04 | Trace API、中文 Board 与 Artifact E2E 证明稳定 Trace ID、诊断入口、Agent Events 下载及路径/大小/SHA-256 联合校验 | Pass |
| REQ-0009-05 | `npm run check`、完整 `npm run test:e2e`、真实 Phoenix 和 Playwright 桌面/窄屏/键盘验收全部通过 | Pass |

## 自动化证据

| 命令 | 结果 |
|---|---|
| `npm run check` | TypeScript 通过；17 个 unit 文件、94 项测试通过；文档图谱 103 documents / 170 relations / 75 Markdown files 有效 |
| `npm run test:e2e` | 4 个文件、10 项真实 Restate/Docker E2E 通过 |
| `npx vitest run tests/e2e/coding-workflow.test.ts` | 最终增量回归 6/6 通过；成功与 Verification 失败 Task 均被本地 OTLP Receiver 捕获 |
| `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high` | 0 vulnerabilities；将既有 `yaml` 从 2.8.1 升至 2.9.0 后复跑全量门禁通过 |
| `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0009/docs-impact.yaml` | 通过：31 required reads / 13 reviewed impacts |

测试环境为 Node.js 22.23.2、Docker 29.2.1、Docker Compose 5.0.2、Codex CLI 0.146.0、Claude Code 2.1.104。Agent CLI 版本只记录环境事实；自动回归不调用真实模型。

## 真实 Demo 与浏览器证据

- Demo Task：`TASK-DEMO-MT2W1U9L`；业务结果 `CLOSED / SUCCEEDED / ARCHIVED`；Agent Session `agent-session-TASK-DEMO-MT2W1U9L`；Result Commit `5891c964a1…`；唯一 Merge Commit `d3e4a25849…`；
- Moye Trace ID：`54a1c333efcc06dbaaa0b0bd68350e50`。Phoenix 项目 `moye-demo` 显示 1 条 Trace，树中含 6 个 Pipeline Attempt、1 个 Agent 子 Span 和 Task Snapshot；详情可见同一 `task.id`、`workflow.id` 与 `attempt.id`；
- Board API 返回 Agent Events allowlisted URL，下载为 NDJSON 且包含同一 Agent Session；默认未生成 Raw Model IO，也未显示敏感入口；
- Playwright 在真实浏览器中验证：卡片 Enter 打开、Escape 关闭并恢复焦点；Trace/Agent Events 是可访问链接；390×844 viewport 的 document scroll width 与 client width 均为 375，无横向溢出；Phoenix 页面控制台 0 error。

## 边界与清理

- 旧 `moye-restate-demo` 已停止，E2E 临时容器、Receiver、Fixture 和 Playwright 临时会话均已清理；
- 为最终人工验收保留 `moye-trace-demo` 与 `moye-phoenix-1`，数据位于忽略目录 `.moye-runtime/trace-demo` 和 Docker named volume；
- Phoenix/OTLP 故障只影响诊断输出，不改变 Task Projection、Restate Journal、唯一 Merge 或 Archive 结果。

## Runtime Closure 重试记录

首次关闭调用 `inv_1duGGEqrlhxt3Whd8BjldCkZMiHzNb6PYE` 被 Bootstrap Gate 以 `BOOTSTRAP_VERIFICATION_NOT_ACCEPTED` 拒绝：本页使用了非协议枚举 `Verified`。拒绝发生在证据持久化和 Archive 之前，Git 工作区与 Task Package 未移动；Runtime Projection 只停留在 `EXECUTING / implementation / NOT_READY`。

处置方式是先把材料状态修正为协议要求的 `Accepted` 并生成新 Result Commit，再保留本记录、精确 purge 已完成且失败的那一个 invocation，最后使用同一 `TASK-0009`、同一 Spec Revision 和同一 Workflow key 重新附着。没有清空或直接编辑 Task/Authority 状态，也没有创建第二个业务 Task。
