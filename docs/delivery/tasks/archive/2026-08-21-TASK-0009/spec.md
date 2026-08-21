# TASK-0009 Spec：轻量 Agent Runtime Trace 与 Phoenix Demo

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0010（由 BL-0006 拆分）

## 目标

在不把 Moye 绑定到某个观测平台的前提下，为 Coding Task 增加一个可运行、可关闭、可追踪的最小观测闭环：Moye 通过标准 OTLP 输出 Task/Attempt/Agent Span，Codex 与 Claude CLI 的原始流式事件继续作为不可采样 Artifact 保存，用户可以从 Moye Task 详情进入 Phoenix 或直接查看对应事件。

## Requirements

### REQ-0009-01：后端无关的轻量 Trace 核心

- Core 提供稳定 `TraceSink` 边界，默认 Noop，不配置时不启动额外服务、不发送网络请求；
- OTLP 实现使用标准 HTTP 协议，配置包含 enabled、endpoint、service/project name 和 UI base URL；
- Trace ID、Span ID 和关联属性可确定重建，至少包含 `task.id`、`workflow.id`、`step.id`、`attempt.id`、`agent.runtime`、`agent.session.id`；
- 一个跨天 Task 不使用单个超长实时 Span；Demo 从已持久化 Attempt 生成短执行 Span，并用稳定 Task Trace ID 关联。

### REQ-0009-02：Agent Runtime 接入与原始证据

- Codex 继续使用 `codex exec --json`，原始 JSONL、stderr、最终消息和 Manifest 保持内容摘要校验；
- 增加 Claude Print/stream-json Adapter，使用 argv 与 `shell:false`，保存原始 stream-json 并提取 session、最终消息与结果；
- Claude 原生 OTel 与可选 Raw API Body 只通过该子进程环境变量注入，不修改用户全局 `settings.json`；
- Raw Prompt/Response/Tool Content 和 API Body 默认关闭；打开时必须明确配置，并把文件限定在当前 Attempt Artifact 目录。

### REQ-0009-03：Phoenix 可选开发体验

- 提供可选 Compose Profile 或等价一条命令启动 Phoenix；Moye 默认仍可独立运行；
- Phoenix 接收 Moye OTLP Trace；配置和健康检查失败应给出清晰诊断，不改变 Task 业务终态；
- Runbook 明确端口、启动、停止、隐私开关、Codex/Claude 能看到的观测层级和版本限制。

### REQ-0009-04：Moye 看板关联与诊断入口

- Coding Trace API 返回稳定 Trace ID、观测后端状态与 Phoenix 入口；
- Task 详情展示 `Trace`、`Agent Events` 和仅在存在时展示的 `Raw Model IO`；
- Agent Artifact 下载必须由 Task/Artifact 白名单和路径约束保护，不能把任意本地路径暴露给浏览器；
- 页面明确 Trace/JSONL 是诊断证据，Task Projection、Domain Event 和 Workflow Journal 仍是状态与恢复权威。

### REQ-0009-05：端到端验收

- 单元测试覆盖配置、稳定 ID、OTLP Payload、Noop、Codex/Claude 解析、环境注入和 Artifact 路由安全；
- 集成测试使用本地 OTLP Receiver 捕获并断言成功/失败 Span 与关联属性；
- 真实 Restate Coding E2E 证明任务闭环、Trace 可查询、Agent Events 可下载且唯一 Merge 不受影响；
- 真实浏览器验证中文入口、键盘语义和窄屏布局；最终通过 `npm run check`、`npm run test:e2e` 与文档影响门禁。

## 非目标

- 不完成 BL-0006 的生产 Metrics、Logs、告警、SLO、鉴权、多租户和长期存储；
- 不把 Phoenix、Grafana、Tempo、Loki、Langfuse 或 OpenLIT 设为 Moye 必选依赖；
- 不承诺获取 Codex 官方 CLI 未暴露的原始 HTTP Request/Response Body；
- 不将 Trace 当成 Task 状态机、恢复 Journal 或不可采样审计历史；
- 不修改用户级 Claude/Codex 配置文件，不向远程仓库 Push。

## 完成定义

从一条本地命令可以启动可选 Phoenix 与 Moye Demo；一个成功或失败 Coding Task 都产生可按 `task_id` 关联的 OTLP Trace，原始 Agent 事件可从 Moye 看板安全打开；关闭 Phoenix 后核心闭环仍正常。所有自动化、真实 Restate E2E、浏览器与文档门禁通过后，TASK-0009 才能由 Runtime 关闭并归档。
