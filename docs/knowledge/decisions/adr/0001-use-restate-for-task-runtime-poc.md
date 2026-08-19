# ADR-0001：使用 Restate 开展首个 Task Runtime PoC

> 状态：Accepted  
> 日期：2026-08-19  
> 适用范围：第一轮 Task Runtime Kernel PoC  
> 关联文档：[Restate PoC 架构](../../current/architecture/poc-01-restate.md)、[方案调研](../../../sources/research/durable-workflow-and-observability-options.md)

## Context

Moye 最大的早期风险不是普通任务队列或多 Agent 数量，而是一个长生命周期 Task 在 Agent、Daemon 或进程中断后，能否安全恢复，同时避免重复昂贵 LLM 调用和不可逆外部副作用。

如果先自建 Journal、Replay、Durable Timer、Worker Recovery 和执行 UI，会把 PoC 变成通用 Workflow Engine 项目，无法快速验证研发领域模型。

候选方案包括 Restate、Hatchet、DBOS、Temporal 和使用 LangGraph 自行补齐外层调度。

## Decision Drivers

- 优先验证中断恢复和 Durable Agent Loop；
- 本地部署应当足够轻；
- 能观察每个 Durable Step 和 Retry；
- 支持 OpenTelemetry；
- 不阻碍未来替换 Workflow Runtime；
- PoC 代码应聚焦 Task、Attempt、Checkpoint 和 Effect 领域协议。

## Considered Options

1. Restate；
2. Hatchet；
3. DBOS；
4. Temporal；
5. LangGraph 加自建外层运行时；
6. 完全自建。

## Decision

第一轮 PoC 使用 Restate 作为 Durable Workflow Runtime。

Moye 自己维护框架无关的：

- Task、Step 和 Attempt；
- TaskEnvelope 和 StepResult；
- Checkpoint；
- EffectRecord 和 Reconcile；
- 领域 Event 和 Task Projection。

本 ADR 不决定最终生产平台，也不排除后续进行 Hatchet 调度对照 PoC。

## Consequences

### Positive

- 可以快速验证 Journal、Replay 和进程恢复；
- Restate 提供 Agent、LLM 和 Tool Durable Step 的直接参考；
- 自带 UI 和 OTel，减少早期基础设施工作；
- PoC 可以把主要精力放在 Task Runtime 的领域语义。

### Negative

- 需要学习 Restate 的编程和部署模型；
- 复杂角色路由和 Worker Affinity 仍需验证；
- PoC 可能暴露出需要额外调度层的需求；
- 未来替换 Runtime 会产生适配成本。

### Risks

- 将 Restate 内部状态误当成完整 Task 领域状态；
- Durable Step 划分不当导致大步骤重复或历史膨胀；
- 误以为 Workflow Replay 自动解决所有 Git 外部副作用；
- PoC 成功被错误解读为生产选型已经完成。

## Validation

按照 [Restate PoC 架构](../../current/architecture/poc-01-restate.md) 注入多个中断点，并验证：

- 已完成 LLM Step 不重复；
- Worker 可以接管；
- UNKNOWN Effect 可以对账；
- 最终状态唯一；
- Workflow、领域 Event 和 Trace 能通过 `task_id` 关联。

以下情况触发重新评估：

- Restate 无法自然表达多 Attempt 接管；
- Worker 路由无法满足预期 Daemon 模型；
- Durable Step 对 Agent Loop 的侵入过高；
- 可观测性无法满足故障定位；
- PoC 需要大量绕过 Restate 的自建基础设施。

## Supersession

- Supersedes：无；
- Superseded by：无。
