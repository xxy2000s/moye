# Durable Workflow 与可观测方案调研

> 类型：Research Note  
> 状态：Draft  
> 版本：v0.1  
> 调研日期：2026-08-19  
> 关联设计：[Task Runtime Kernel 详细设计](../../knowledge/current/architecture/task-runtime-kernel.md)

## 1. 调研问题

本调研回答两个问题：

1. Task 的 Durable Workflow、失败重试和中断恢复是否需要全部自建；
2. Workflow 看板、分布式 Trace 和 LLM Trace 是否有可直接复用的现成方案。

## 2. 结论摘要

不应自建完整 Durable Workflow Engine。

推荐架构是：

> 复用 Durable Workflow Runtime，自己实现代码研发领域层。

现成框架已经可以覆盖：

- Durable Journal 和 Replay；
- Worker/Daemon 派发；
- 崩溃恢复；
- Retry、Backoff、Timeout；
- Durable Timer 和事件等待；
- 暂停、取消和恢复；
- Workflow 执行历史；
- 基础运维 UI；
- OpenTelemetry 导出。

仍然需要自建：

- Task、Step、Attempt、Artifact 和 Claim；
- Retry、Repair、Replan 的领域分类；
- Worktree checkpoint 和跨节点恢复；
- Git、PR、Merge Queue 和 Effect Reconcile；
- 验收条件、Gate 和证据映射；
- Agent 角色及权限；
- 知识候选、验证和提升；
- 面向研发语义的 Task 看板。

## 3. 评估维度

| 维度 | 说明 |
|---|---|
| 部署复杂度 | 本地和生产所需组件数量 |
| Durable Execution | Journal、Replay、Checkpoint 和恢复能力 |
| Worker 调度 | 队列、角色路由、标签、亲和性和并发控制 |
| Loop 表达 | 循环、动态子任务、人工等待和重新规划 |
| 故障控制 | Retry、Timeout、Cancel、Resume 和 Reconcile 支持 |
| 可观测性 | 内置 UI、Timeline、Trace、Metrics 和日志 |
| Agent 适配 | LLM、Tool Call、Checkpoint 和 Agent SDK 集成 |
| 自托管 | 是否开源、依赖和运维成本 |
| 成熟度 | 生态、生产案例、版本治理和长期风险 |

## 4. Durable Workflow 候选

### 4.1 Restate

#### 特点

- 本地可通过单个 Restate Server 启动；
- Workflow 以普通函数表达；
- Durable Step、Promise、Timer、状态和服务调用；
- 执行 Journal 支持崩溃后 Replay；
- 已完成的 LLM 调用和工具调用可以从 Journal 复用；
- 自带 Restate UI；
- UI 可检查 Invocation、Journal、State 和嵌套调用；
- 支持取消和 Kill；
- 自动产生并导出 OpenTelemetry trace。

Restate 的 Agent 文档明确将 LLM、Tool 和路由决策作为 Durable Agent 的步骤，并展示进程崩溃后的恢复流程。

#### 优点

- 部署和编程模型轻量；
- Agent Durable Execution 是官方明确支持的场景；
- 适合快速验证中断、恢复和交接；
- 内置 UI 已能观察 Agent Step；
- 可以和现有 Agent SDK 组合。

#### 风险和限制

- 相比 Temporal，生态和长期生产经验更少；
- 角色队列、复杂资源调度和 Worker Affinity 需要进一步验证；
- 仍需自行实现 Worktree 和 Git 领域恢复；
- Durable Step 之外的副作用仍必须遵守幂等和对账约束。

#### 适用判断

适合作为 Task Runtime Kernel 的第一轮技术原型，优先验证最困难的恢复语义。

#### 官方资料

- [Restate Workflows](https://docs.restate.dev/tour/workflows)
- [Restate Durable Agents](https://docs.restate.dev/ai/patterns/durable-agents)
- [Restate Observability & Control](https://docs.restate.dev/ai/patterns/observability-control)
- [Restate Invocations](https://docs.restate.dev/foundations/invocations)

### 4.2 Hatchet

#### 特点

- Durable Task Queue 和 Workflow Engine；
- Worker 自主管理，编排引擎可托管或自托管；
- Task、DAG 和 Durable Task；
- Worker slots、标签、亲和性、优先级、并发和速率限制；
- 自动 Retry、Timeout、Cancellation、Replay；
- Durable Event Log 和 Checkpoint；
- 实时 Web UI、日志和 Workflow Run 历史；
- OpenTelemetry 和 Prometheus。

#### 优点

- 和 Daemon 集群、分角色派发的目标高度匹配；
- 调度和队列能力比纯 Agent Graph 更完整；
- 自带操作看板；
- 自托管主要围绕 Hatchet Engine 和 PostgreSQL；
- 支持动态工作流和子任务。

#### 风险和限制

- Durable Task 的编程约束需要在 PoC 中验证是否适合长 Agent Loop；
- 需要确认 Worker 故障恢复和 checkpoint 粒度是否满足代码任务；
- Worktree 跨节点迁移仍是自建领域能力；
- 相比 Temporal，生态和工作流版本治理经验更少。

#### 适用判断

如果首要目标是尽快构建多 Daemon、按角色路由、带运维看板的执行集群，Hatchet 是优先候选。

#### 官方资料

- [Hatchet Durable Execution](https://docs.hatchet.run/v1/durable-execution)
- [Hatchet 产品与能力概览](https://hatchet.run/)
- [Hatchet GitHub](https://github.com/hatchet-dev/hatchet)

### 4.3 DBOS

#### 特点

- 以 PostgreSQL 作为 Durable Workflow 的核心存储；
- 支持 Workflow、Step、Queue、Recovery 和版本；
- 单机重启后可以恢复 Pending Workflow；
- 分布式自动恢复由 DBOS Conductor 负责；
- DBOS Console 提供 Workflow 列表、Step Timeline、Cancel、Resume 和 Fork；
- 自动产生 Workflow 和 Step 的 OpenTelemetry spans。

#### 优点

- 对已经使用 PostgreSQL 的团队非常自然；
- 代码接入成本低；
- Workflow 和 Step 可以直接进入现有 OTel 体系；
- Console 支持从指定 Step Fork，适合故障分析。

#### 风险和限制

- 分布式 Executor 自动接管依赖 Conductor；
- Workflow 管理和高级看板也依赖 Conductor；
- 需要评估自托管 Conductor 或使用其托管控制面的接受度；
- 自建分布式 recovery 时仍需管理 Executor ID 和唯一恢复。

#### 适用判断

如果项目明确采用 PostgreSQL，并希望尽量减少独立基础设施，可以进入 PoC；否则优先级低于 Restate 和 Hatchet。

#### 官方资料

- [DBOS Quickstart](https://docs.dbos.dev/quickstart)
- [DBOS Workflow Recovery](https://docs.dbos.dev/production/workflow-recovery)
- [DBOS Workflow Management](https://docs.dbos.dev/production/workflow-management)
- [DBOS Conductor](https://docs.dbos.dev/production/conductor)
- [DBOS Logging & Tracing](https://docs.dbos.dev/typescript/tutorials/logging)

### 4.4 Temporal

#### 特点

- 成熟的 Durable Workflow Platform；
- Workflow Event History 和确定性 Replay；
- Activity、Child Workflow、Signal、Update、Timer、Retry 和 Cancellation；
- Temporal Web UI；
- 支持自托管和 Temporal Cloud；
- 本地开发服务器是包含 Web UI 的无外部依赖单二进制；
- 生产自托管涉及数据库、Visibility、监控、安全、升级和归档。

#### 优点

- 长生命周期和关键任务的可靠性能力最成熟；
- Workflow 版本治理、历史恢复和集群能力完整；
- 多语言 SDK 和生态更丰富；
- 适合未来公司级统一任务基础设施。

#### 风险和限制

- 编程模型要求理解确定性和 Activity 边界；
- 生产运维成本高于轻量方案；
- 对早期原型可能过重；
- Agent 内部每次 LLM/Tool checkpoint 需要自行封装成 Activity 或更细粒度协议。

#### 适用判断

如果系统从一开始就被视为关键基础设施，或者预期很快进入大规模、多团队和长期运行场景，Temporal 是最稳妥方案。

#### 官方资料

- [Temporal Documentation](https://docs.temporal.io/)
- [Temporal Workflows](https://docs.temporal.io/workflows)
- [Temporal Self-hosting Guide](https://docs.temporal.io/self-hosted-guide)

### 4.5 LangGraph

#### 特点

- 使用 Graph 表达 Agent 流程；
- Checkpointer 保存线程范围内的 Graph State；
- Store 保存跨线程的长期数据；
- 支持 SQLite 和 PostgreSQL Checkpointer；
- 支持中断、恢复、Human-in-the-loop 和 Time Travel。

#### 优点

- Agent 内部 Loop 表达自然；
- Python 生态中接入方便；
- Checkpoint 和 Store 概念与 Agent 运行匹配。

#### 风险和限制

- 它首先是 Agent Graph Runtime，不是完整的分布式研发任务控制面；
- Worker 调度、Daemon Registry、SCM Effect、Worktree 和 Merge 仍需实现；
- 单独使用时无法替代 Task Runtime Kernel 的外层 Workflow；
- 长期 Checkpoint 需要自行处理保留和膨胀。

#### 适用判断

LangGraph 可以作为某个 Planner 或 Coder Agent 的内部执行引擎，但不建议单独承担完整研发 Task 生命周期。

#### 官方资料

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph Checkpoint Reference](https://langchain-ai.github.io/langgraph/reference/checkpoints/)

## 5. 方案对比

| 方案 | 本地部署 | 分布式执行 | 角色调度 | Durable Agent | 内置 UI | OTel | 综合判断 |
|---|---|---|---|---|---|---|---|
| Restate | 单 Server | 支持 | 需验证复杂路由 | 强 | 有 | 有 | 最适合恢复语义 PoC |
| Hatchet | Engine + PostgreSQL | 强 | 强 | 强 | 有 | 有 | 最适合 Daemon 调度 PoC |
| DBOS | 应用 + PostgreSQL | Conductor 辅助 | 有 Queue | 中 | Conductor | 有 | PostgreSQL 优先时考虑 |
| Temporal | 本地单二进制，生产较重 | 很强 | Task Queue | 需自行封装 | 有 | 有 | 长期关键基础设施 |
| LangGraph | 库 + Checkpointer | 需外层平台 | 弱 | 强 | 依赖平台 | 可接入 | 只作为 Agent 内层 |

以上判断是面向本项目需求的架构推论，不等同于各项目官方的通用性能或成熟度排名。

## 6. 看板与 Trace 分层

不建议试图使用一个看板同时承载 Workflow 运维、LLM 调试和研发业务语义。

### 6.1 Workflow 运维看板

目标用户是平台开发和运维人员，主要查看：

- Workflow 当前状态；
- 当前和历史 Step；
- Retry、Timeout 和错误；
- Worker/Daemon 执行位置；
- 等待中的 Timer 或外部事件；
- 暂停、取消、恢复和 Replay。

可直接使用：

- Restate UI；
- Hatchet Dashboard；
- DBOS Console；
- Temporal Web UI。

这一层原则上不自建。

### 6.2 Agent 与 LLM Trace

目标用户是 Agent 开发者，主要查看：

- Prompt 和模型响应；
- Tool Call 输入输出；
- 模型、Token、成本和延迟；
- Agent 路由和上下文；
- 检索结果；
- 自动评分和人工标注。

#### Arize Phoenix

- 开源；
- 基于 OpenTelemetry 和 OpenInference；
- 可本地启动；
- 支持 LLM、Tool、Retrieval Trace；
- 支持 Session、Annotation、Metrics 和 Evaluation；
- 适合作为早期轻量 LLM Trace UI。

资料：

- [Phoenix Tracing](https://arize.com/docs/phoenix/tracing/llm-traces)
- [Phoenix Overview](https://arize.com/docs/phoenix/)

#### Langfuse

- 面向 LLM 的 Trace、Observation 和 Session；
- 支持 Prompt、Response、Token、Cost、Score 和 Dashboard；
- 基于 OpenTelemetry；
- 开源并支持自托管；
- 适合后期质量评估、Prompt 管理和成本分析。

资料：

- [Langfuse Observability](https://langfuse.com/docs/observability/overview)
- [Langfuse Data Model](https://langfuse.com/docs/observability/data-model)

### 6.3 基础设施可观测性

目标用户是平台运维人员，主要查看：

- Daemon 和 Worker 健康；
- Queue 深度和排队时间；
- CPU、内存、磁盘和 Sandbox；
- 错误率、吞吐和延迟；
- Trace、Log、Metric 关联。

可采用：

```text
OpenTelemetry Collector
  → Grafana Tempo：Trace
  → Loki：Log
  → Prometheus/Mimir：Metric
  → Grafana：Dashboard
```

资料：

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Grafana Tempo](https://grafana.com/docs/tempo/latest/)
- [Grafana Trace Visualization](https://grafana.com/docs/tempo/latest/visualize-traces/)

### 6.4 研发 Task 业务看板

该层需要自建一个薄领域 UI，因为通用 Workflow UI 不理解：

- Requirement 和 Acceptance Criteria；
- Task、Step、Attempt 的领域关系；
- Worktree、branch、base SHA 和 head SHA；
- 修改文件和代码证据；
- Review、Gate 和 Repair Loop；
- PR、Merge Queue 和 merge SHA；
- Knowledge Candidate 和后续使用效果。

业务看板不保存第二份执行事实，只聚合并链接：

```text
Task Projection
+ Workflow Invocation URL
+ LLM Trace URL
+ Artifact URL
+ PR / Commit URL
+ Knowledge URL
```

## 7. 推荐组合

### 7.1 第一阶段：恢复语义优先

```text
Restate
  + Moye Task Domain
  + Worktree / Git Adapter
  + PostgreSQL Task Projection
  + S3 / MinIO Artifact
  + Restate UI
  + Phoenix
```

目标：以最小部署验证 Task 被随机中断后，是否能够跨执行者从安全点恢复，并且不重复外部副作用。

### 7.2 第一阶段备选：Daemon 调度优先

```text
Hatchet
  + Moye Task Domain
  + Role Workers
  + Worktree / Git Adapter
  + Hatchet Dashboard
  + Phoenix
```

目标：优先验证多 Daemon、角色队列、标签路由、Worker slots 和并发控制。

### 7.3 长期演进

如果 PoC 后发现以下条件成立，应重新评估 Temporal：

- Task 成为关键生产基础设施；
- 多团队共享同一 Workflow 平台；
- 大量 Task 跨天或跨周运行；
- Workflow 版本演进复杂；
- 需要更强的集群容灾和长期历史；
- 团队能够承担生产自托管或使用 Temporal Cloud。

## 8. PoC 建议

不要只实现 Happy Path。用同一个最小代码任务分别验证候选方案。

### 8.1 场景

1. 创建 Task 和 Worktree；
2. Planner 产生两个 Step；
3. Coder 调用一次 LLM、一次文件工具；
4. 保存 Checkpoint；
5. 强制 Kill Worker；
6. 由另一 Worker 恢复；
7. 执行测试；
8. 模拟 Review 失败并 Repair；
9. 模拟 Push 已成功但响应超时；
10. Reconciler 确认结果；
11. 完成合并并关闭 Task；
12. 在 UI 中查询完整 Timeline 和 LLM Trace。

### 8.2 评分指标

| 指标 | 说明 |
|---|---|
| 恢复正确性 | 已完成 Step 和副作用是否重复 |
| 接管时间 | Worker 死亡到新 Worker 开始执行 |
| 编程复杂度 | 实现 Loop、Wait、Repair 和 Replan 的代码量 |
| 运维复杂度 | 本地和生产组件数量 |
| 调度能力 | 是否方便按角色、能力和负载路由 |
| 可观测性 | 是否能从 Task 找到 Workflow、LLM 和工具 Trace |
| 版本治理 | Workflow 代码升级如何处理运行中任务 |
| 领域可扩展性 | 是否容易加入 Effect Ledger 和自定义状态 |

### 8.3 决策门槛

候选方案只有在以下条件全部满足时才进入正式设计：

- Worker 随机退出后能够自动恢复；
- 已完成的昂贵 LLM 调用不会重复；
- 非幂等副作用可以安全对账；
- 能表达 Attempt Retry、Repair 和 Replan；
- 能按 `task_id` 查询完整历史；
- 能导出 OTel；
- 能在本地环境一条命令或一个 Compose 启动；
- 领域模型不被框架内部状态模型绑死。

## 9. 当前建议

当前建议不是立即锁定最终框架，而是进行一个小规模双 PoC：

1. 使用 Restate 验证 Durable Agent、Journal、恢复和交接；
2. 使用 Hatchet 验证角色队列、Daemon 调度、Worker Affinity 和看板。

两个 PoC 共享相同的 TaskEnvelope、StepResult、Checkpoint 和 EffectRecord 协议。这样比较的是运行时能力，而不是两套不同的业务实现。

如果只能先做一个，优先 Restate。原因是当前最大的未知不是普通 Queue 调度，而是 Agent Loop 中断后能否在不重复昂贵调用和外部副作用的前提下正确恢复。

## 10. Research 维护规则

- 每份 Research Note 标注调研日期；
- 关键事实优先引用官方文档；
- 明确区分官方能力描述和本项目推论；
- 版本变化可能使结论失效，进入实现阶段前重新核对；
- PoC 数据和故障注入结果应补充到本文件或单独实验报告；
- 最终选型形成 ADR，Research Note 保留未选择方案和判断依据。
