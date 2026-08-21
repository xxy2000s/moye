# ADR-0004：使用 OTLP 契约与可选 Phoenix 作为轻量 Trace Demo

> 状态：Accepted  
> 日期：2026-08-21  
> 决策者：Moye PoC  
> 关联文档：[TASK-0009 Spec](../../../delivery/tasks/archive/2026-08-21-TASK-0009/spec.md)、[Restate PoC 架构](../../current/architecture/poc-01-restate.md)

## Context

Moye 已有 Task Projection、Restate Journal 和本地 Agent Artifact，但缺少可由通用工具消费的运行时 Trace。首个 Demo 需要足够轻、默认无额外服务，同时允许查看 Attempt、Agent Session 和技术耗时。Trace 不能成为第二套任务状态机，也不能迫使核心代码绑定某个观测产品。

## Decision Drivers

- 默认运行 Moye 时零额外基础设施和零遥测网络请求；
- 使用稳定开放协议，后续可以替换本地或生产后端；
- 保留 JSONL 等不可采样原始证据，不用 Trace 代替审计事实；
- 提供一条命令可体验的本地可视化；
- Prompt、Response、Tool Content 和 Raw API Body 必须显式选择后才能采集。

## Considered Options

1. Core 输出 OTLP/HTTP，默认 Noop，Phoenix 仅作为可选本地 Profile；
2. Core 直接依赖 Phoenix 或其他厂商 SDK；
3. 只保存 Codex/Claude JSONL，不输出标准 Trace；
4. 仅依赖各 Agent CLI 的原生遥测。

## Decision

Moye Core 定义 `TraceSink`，默认使用 `NoopTraceSink`；显式开启后通过 OpenTelemetry 官方 OTLP/HTTP protobuf exporter 输出。`task.id` 是跨系统关联根，稳定 Trace ID 用于查询；从已持久化 Projection 重建有起止时间的短 Attempt/Agent Span，不创建跨天存活的 Task Span。

Phoenix 19.10.0 只作为本地 Compose `trace` Profile 和演示 UI，不是 Moye 的运行依赖或业务权威。其他兼容 OTLP 的后端可以替换它。Agent JSONL 在 CLI 运行时先按完整行写入受管 Run Stream，并通过 Task Projection 中的稳定 Run locator 由 Moye Board cursor API 只读展示；运行结束后，JSONL、stderr、最终消息和可选 Raw Model IO 继续以内容摘要 Artifact 冻结。Stream 和 Artifact 都是诊断证据，不进入 Restate Journal，也不推进 Task 状态。

Claude 原生遥测只通过单次子进程环境变量开启，不修改用户级配置；所有内容采集开关默认关闭。Codex CLI 未公开的原始 HTTP Request/Response 不在本决策承诺范围内。

## Consequences

### Positive

- 核心只依赖标准 OTel API/Exporter，Phoenix 可以随时关闭或替换；
- 无配置时不增加端口、容器或网络副作用；
- Trace、Journal、Projection 和 Artifact 的权威边界清晰；
- 本地 Demo 可以直接从 Task 进入 Trace UI 和原始 Agent 事件。

### Negative

- Phoenix 镜像和本地数据卷仍有额外磁盘成本；
- 从 Projection 导出的历史 Span 主要用于诊断，不等于实时流式追踪；
- Moye Trace 与 Claude 原生 Trace 的层级、字段和 CLI 版本能力可能不完全一致。

### Risks

- 遥测导出失败掩盖真实问题；通过真实 OTLP Receiver、Phoenix 验收和 stderr 诊断控制，但不回写 Task 终态；
- 敏感内容误采集；通过默认关闭、进程级配置、受管目录和看板敏感标识控制；
- Artifact 路径逃逸；通过 Task 投影白名单、受管根、realpath、文件类型、大小和 SHA-256 联合校验控制。

## Validation

- 默认配置下 Noop 测试证明没有网络导出；
- 本地 Receiver 解码 OTLP/protobuf 并断言稳定 ID、父子关系与关联属性；
- 真实 Restate E2E 和 Phoenix Demo 均能按 `task.id` 查看 Trace，且唯一 Merge 不受遥测故障影响；
- Board Artifact 安全测试覆盖越界、符号链接和摘要不匹配。

## Supersession

- Supersedes：无；
- Superseded by：无。
