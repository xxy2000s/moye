# 多 Agent 研发 Core 闭环需求基线

> 文档类型：Brainstorm / Requirement Baseline  
> 状态：Draft / Partially Consumed
> 基线日期：2026-08-22  
> 目标范围：单机、单仓库、单 Task、多 Agent 角色、单 Active Attempt  
> 当前实现基线：commit `fab7fae`
> 取代范围：[Task 全生命周期与 Worktree 收束](./task-lifecycle-and-worktree-convergence.md)中的当前 Core 路线、REQ-LC 拆分和实施顺序  
> 目标消费方：Backlog、Active Task Spec、Task Runtime、Coding Workflow、Agent Runtime、Document Control Plane

> 本文是当前讨论收敛后的母需求，但在进入 Backlog、Active Task、Architecture 或 ADR 前仍属于 `idea-input`，不能直接覆盖当前代码和 Architecture 事实。

> 消费进度：六个 Slice 已进入 Backlog；Slice 1 已由 [TASK-0013](../../delivery/tasks/archive/2026-08-22-TASK-0013/spec.md) 完成并归档，Slice 2 已由 [TASK-0014](../../delivery/tasks/archive/2026-08-22-TASK-0014/spec.md) 完成并归档，Slice 3 已由 [TASK-0015](../../delivery/tasks/archive/2026-08-22-TASK-0015/spec.md) 完成并归档，Slice 4 已由 [TASK-0016](../../delivery/tasks/archive/2026-08-22-TASK-0016/spec.md) 完成并归档。其余 Slice 只登记 Backlog，尚未伪造 Active Task 或实现事实。

## 1. 需求结论

Moye 下一阶段不建设完整外围 Harness，也不引入多 Daemon 抢占、Lease、Fencing 或跨机器 Handoff。当前唯一目标是让单机、多角色 Agent 的研发 Core 在成功、失败、中断和返工情况下形成可靠闭环。

目标 Core 由以下部分组成：

```text
CoreClosureWorkflow/<task_id>       唯一持久状态权威
        │
        ├── Orchestrator Agent      读取状态并提出控制决策
        ├── Docs Agent              Spec、设计、Docs Impact、知识同步
        ├── Implementation Agent    实现、测试、Self Review、Checkpoint
        ├── Review Agent            独立 Review 与 Finding
        ├── Verification Gate       确定性验收
        └── Observer Agent          只读观察、Trace、异常与经验候选
```

![Moye多Agent研发Core最终闭环架构与当前实现差距](./assets/multi-agent-core-closure-final.png)

可编辑源文件：[最终 Core 闭环 SVG](./assets/multi-agent-core-closure-final.svg)。

## 2. 范围

### 2.1 本期必须完成

- 一个 Restate keyed Core Workflow 拥有 Task Core 主状态；
- Orchestrator Agent 根据持久化事实提出下一步控制决策；
- Docs、Implementation、Review 三类执行角色使用统一 Role Attempt 协议；
- Implementation Agent 产生显式 Self Review；
- Review Finding 和 Verification Failure 能驱动 Retry、Repair 或 Replan；
- Observer Agent 只读观察并输出 Trace、告警和知识候选；
- Coding Workflow 强制执行最终 Docs Impact；
- `SUCCEEDED`、`FAILED_TERMINAL` 和 `CANCELLED` 都生成唯一 `CoreClosureResult`；
- 任意 Worker 或 Agent 中断后能够从 Workflow、Attempt、Artifact 和 Checkpoint 接管。

### 2.2 本期明确不做

- 多 Daemon 任务池、Lease、Heartbeat、Fencing 和抢占；
- 多个 Active Attempt 并发修改同一 Workspace；
- 远程 Git Provider、PR、审批和发布；
- 跨项目容量调度和企业级项目看板；
- Workspace Finalize、Cleanup Receipt 和长期 Retention；
- 把 Restate、Board、Trace 或 Observer 变成第二套 Task 状态机；
- 自动把一次 Agent 建议直接提升为 Accepted ADR 或当前 Architecture。

当前已经存在的 Worktree Provision、Merge、Board 和 Archive 可以继续保留，但不得成为 Core 需求实施的前置阻塞。

## 3. 当前实现基线

### 3.1 已经具备

- `TaskEnvelope` 固定 Task、Spec Revision、Base SHA、Requirements、Validation Commands 和 Context Plan；
- `CodingTaskWorkflow/<task_id>` 使用 Restate Journal、Projection、`ctx.run` 和独立 ArchiveWorkflow；
- `IMPLEMENT/attempt-001` 已接入 Fake、Codex 和 Claude Runner；
- Agent Run ID、Session、JSONL、Artifact Manifest、Git Checkpoint 和未知结果保护已经存在；
- Verification Gate 绑定 Candidate Commit，并保存可重复 Evidence；
- Merge 丢回执和 Worker 强杀后的 Git Reconcile 已有测试；
- ProjectBoard、实时 Agent Events、Coding Trace 和可选 OTLP Export 可以关联 Task、Attempt、Agent、Git、Verification 和 Restate Workflow；
- Document Graph、Context Router 和 Docs Impact Validator 已存在。

相关实现入口：

- [固定 Coding Workflow](../../../src/coding/workflow.ts)；
- [Restate Coding Service](../../../src/restate/coding-services.ts)；
- [Agent Runner](../../../src/agent/runner.ts)；
- [Coding Trace](../../../src/trace/coding-trace.ts)；
- [OTLP Telemetry](../../../src/trace/telemetry.ts)；
- [Verification Gate](../../../src/verification/gate.ts)；
- [Document Control Plane](../../knowledge/current/architecture/document-control-plane.md)。

### 3.2 关键缺口

当前流程仍固定为：

```text
CONTEXT → WORKSPACE → IMPLEMENT → VERIFY → MERGE → DOCS → CLOSED → ARCHIVE
```

它缺少 Orchestrator Agent、Docs Agent、Self Review Step、Review Agent、Observer Agent、Review Finding、Retry/Repair/Replan 循环、Coding Docs Impact Gate 和统一失败/取消 Closure。确定性 Agent 或 Verification 失败会直接进入 `FAILED_TERMINAL`，不会在同一 Task 内返工。

## 4. 核心不变量

以下不变量是所有需求的共同验收条件：

1. 只有 `CoreClosureWorkflow` 可以推进 Core 主状态；
2. Orchestrator Agent 只能提交候选 `ControlDecision`，不能直接改 Projection；
3. 任意时刻最多存在一个 Active Role Attempt；
4. Role Agent 只提交 Result、Finding、Artifact 和 Checkpoint；
5. Observer Agent 只读，不能调度 Retry、关闭 Task 或覆盖 Review Finding；
6. Operation Retry、Attempt Retry、Repair 和 Replan 必须使用不同事件和预算；
7. 终态 Attempt 不得复活；新执行创建递增 Generation；
8. 已确认的昂贵 Agent Run 不得重复执行；
9. `UNKNOWN_SIDE_EFFECT` 必须先 Reconcile，不能盲目新建 Attempt；
10. Prompt、聊天历史、Agent 内存和本地临时目录不能成为唯一恢复信息；
11. Trace 和 Board 只读派生，不能成为业务事实源；
12. `SUCCEEDED`、`FAILED_TERMINAL` 和 `CANCELLED` 都必须通过同一个 Core Closure Gate。

## 5. 目标主流程

```text
TaskEnvelope
  → Orchestrator: SCHEDULE_DOCS
  → Docs Agent: Spec / Plan / Design Artifact
  → Orchestrator: SCHEDULE_IMPLEMENTATION
  → Implementation Agent: Code / Tests / Self Review / Checkpoint
  → Orchestrator: SCHEDULE_REVIEW
  → Review Agent: ReviewResult + Findings
  → Verification Gate
      ├─ 实现缺陷 → REPAIR → Implementation Attempt N+1
      ├─ 方案失效 → REPLAN → Spec Revision N+1 → Docs Agent
      ├─ 明确未执行 → RETRY → 当前 Operation
      ├─ UNKNOWN → RECONCILE / WAIT
      ├─ 预算耗尽 → FAILED_TERMINAL 候选
      └─ 通过
  → Docs Agent: Docs Impact + Knowledge Sync
  → Core Closure Gate
  → CoreClosureResult
```

Observer Agent 从 Event、Projection 和 Artifact 旁路观察整条流程，不插入主状态流。

## 6. 核心数据契约

以下字段是需求级约束，具体 TypeScript 命名可在详细设计中调整。

### 6.1 ControlDecision

```yaml
decision_id: stable digest
task_id: TASK-NNNN
spec_revision: 1
expected_projection_version: 12
expected_state: REVIEWING
action: RETRY | REPAIR | REPLAN | SCHEDULE_ROLE | WAIT | CLOSE
target_role: DOCS | IMPLEMENTATION | REVIEW | null
source_finding_refs: []
evidence_refs: []
reason: human-readable explanation
budget_request: {}
decision_digest: sha256:...
```

Workflow 必须拒绝状态过期、版本不匹配、预算不足、存在 Active Attempt 或跳过 Required Gate 的决策。

### 6.2 RoleRunRequest / RoleRunResult

```yaml
role: DOCS | IMPLEMENTATION | REVIEW
step_id: stable step id
attempt_id: task/step/attempt-NNN
generation: 1
input_digest: sha256:...
workspace_or_artifact_scope: stable reference
prompt_digest: sha256:...
run_id: stable digest
```

RoleRunResult 必须包含 Outcome、结构化 Artifact Manifest、Result Digest、错误分类和可选 Session ID。不同角色使用同一执行外壳，但输出 Schema 不同。

### 6.3 ReviewFinding

```yaml
finding_id: stable digest
category: IMPLEMENTATION | DESIGN | REQUIREMENT | TEST | DOCUMENTATION | INFRASTRUCTURE
severity: BLOCKING | MAJOR | MINOR | INFO
requirement_refs: []
evidence_refs: []
summary: string
recommended_action: REPAIR | REPLAN | RETRY | ACCEPT
status: OPEN | RESOLVED | SUPERSEDED | ACCEPTED_RISK
```

`BLOCKING` Finding 未处理时不能进入成功 Closure。

### 6.4 ObserverReport

```yaml
task_id: TASK-NNNN
projection_version: 12
trace_summary: {}
alerts: []
cost_summary: {}
knowledge_candidates: []
report_digest: sha256:...
```

ObserverReport 是诊断和候选输入，不是业务状态权威。

### 6.5 CoreClosureResult

```yaml
task_id: TASK-NNNN
spec_revision: 1
outcome: SUCCEEDED | FAILED_TERMINAL | CANCELLED
result_commit: optional git sha
required_attempts: []
review_result_ref: optional artifact ref
verification_ref: optional artifact ref
failure_evidence_refs: []
docs_impact_ref: artifact ref
knowledge_sync_ref: artifact ref
unresolved_findings: []
active_attempt_count: 0
unknown_effect_count: 0
trace_ref: stable task trace ref
closure_digest: sha256:...
```

## 7. 功能需求

### CORE-REQ-01：Orchestrator ControlDecision（P0）

**目标**：把固定 TypeScript 顺序改造成“Workflow 持久化状态、Orchestrator 提出下一步、Workflow 校验并执行”的控制闭环。

**验收标准**：

- Orchestrator 的输入只来自持久化 Projection、TaskEnvelope、Finding、Artifact 和预算；
- Orchestrator 不依赖之前的聊天历史即可重新启动；
- 每个 ControlDecision 绑定 Expected State、Projection Version 和 Digest；
- 过期、重复和非法 Decision 不推进状态；
- Restate 重放不会重复派发已经确认的 Role Run；
- Orchestrator 异常退出后可以由同角色新 Run 从相同事实继续；
- Workflow 仍是唯一主状态写入者。

### CORE-REQ-02：统一 Role Agent Attempt 协议（P0）

**目标**：在当前 Agent Runner 上接入 Docs、Implementation 和 Review 三种角色，而不是只支持固定 IMPLEMENT Agent。

**验收标准**：

- 三种角色共享稳定 RoleRunRequest、Run ID、Artifact Manifest 和 Result Digest 机制；
- 每次实际运行都绑定独立 Step Attempt 和 Generation；
- Docs Agent 生成 Spec/Plan/Design 或 Docs Impact Artifact；
- Implementation Agent 生成代码、测试、Checkpoint 和 Self Review Artifact；
- Review Agent 只读候选实现并生成 ReviewResult 与 Finding；
- Workflow 保证同一时刻最多一个 Active Attempt；
- 已完成角色 Run 在 Worker 重启后直接复用，不再次调用模型。

### CORE-REQ-03：Self Review、ReviewResult 与 Finding（P0）

**目标**：把“Agent 说完成了”升级为可独立审查、可驱动返工的结构化结果。

**验收标准**：

- Implementation Attempt 必须产出 Self Review Artifact；
- Review Agent 输入绑定 Spec Revision、Candidate Commit、Diff 和验证证据；
- ReviewResult 明确 `PASSED | FINDINGS`；
- Finding 具有稳定 ID、Category、Severity、Evidence 和状态；
- Blocking Finding 未解决时不能 Verification Passed 或成功关闭；
- Repair 后旧 Finding 被标记为 `RESOLVED` 或 `SUPERSEDED`，历史不删除；
- Review Agent 失败与“Review 发现问题”使用不同错误语义。

### CORE-REQ-04：Retry、Repair、Replan 与预算（P0）

**目标**：在同一个 Core Task 内对可恢复失败进行有限循环，而不是首次失败即 `FAILED_TERMINAL`。

**验收标准**：

- Operation Retry 不创建新 Attempt，只用于明确未发生的瞬态操作；
- Agent/Worker 重试创建 Attempt N+1，不复活旧 Attempt；
- Repair 绑定 Finding 并回到 Implementation；
- Replan 增加 Spec Revision，并显式使不再适用的旧 Evidence 失效；
- 预算至少覆盖 Operation Retry、Role Attempt、Repair、Replan、模型调用和总耗时；
- 超出预算只产生一次 `FAILED_TERMINAL` 候选；
- UNKNOWN 进入 Reconcile/Wait，不能自动并行启动新 Agent；
- Review Fail→Repair→Review Pass 和 Design Fail→Replan 两条 E2E 路径通过。

该需求细化现有 [BL-0003](../../delivery/backlog/BL-0003.yaml)。

### CORE-REQ-05：Observer Agent（P1）

**目标**：在不拥有状态的前提下，持续整理执行 Trace、异常、成本和知识候选。

**验收标准**：

- Observer 只通过只读 Projection、Event 和 Artifact 接口获取事实；
- Observer 能关联 Task、Role Attempt、Agent Session、Commit、Finding、验证和 Restate Invocation；
- 输出阶段耗时、模型调用、Token/Cost、重试次数和异常摘要；
- 发现长时间无进展、重复失败和预算逼近时产生告警候选；
- 输出 Pitfall、Finding、Backlog、Runbook 和 Docs Impact 候选，但不能直接提升长期知识；
- Observer 崩溃不改变业务状态，确定性 Trace 仍然可查询；
- Observer 重跑不会重复写入相同 Digest 的候选。

该需求收窄并细化 [BL-0006](../../delivery/backlog/BL-0006.yaml) 和 [BL-0007](../../delivery/backlog/BL-0007.yaml) 的 Core 部分。

### CORE-REQ-06：Coding Docs Impact 与 Knowledge Sync（P0）

**目标**：把现有 Document Graph、Router 和 Impact Validator 接入 Core Workflow，而不是只写一个 disposition JSON。

**验收标准**：

- Task 开始时把 Context Plan 注入 TaskEnvelope；
- 实际 changed paths 扩张时刷新 Required Read/Review；
- 最终 Candidate 或失败材料形成后重新 Route；
- Docs Agent 对每个 Required Review 给出 `updated | unchanged | not_applicable` 和理由；
- 新 Markdown 必须登记图谱、建立关系并加入索引；
- Workflow 执行 `docs_graph validate` 和 `validate-impact`；
- Finding、ObserverReport 和失败证据可以生成知识候选；
- 未经 Gate 不得自动改写 Accepted ADR 或当前 Architecture；
- Docs Impact 未通过时 Task 保持可恢复，不得成功关闭。

### CORE-REQ-07：统一 Core Closure Gate（P0）

**目标**：让成功、失败和取消都得到唯一、可解释的 Core 业务终态。

**验收标准**：

- 支持 `SUCCEEDED | FAILED_TERMINAL | CANCELLED` 三种 Outcome；
- Closure 前所有 Required Attempt 已终结，Active Attempt 数为零；
- 不存在未解决 `UNKNOWN_SIDE_EFFECT`；
- 成功必须绑定最终 Candidate Commit、Review Passed 和 Verification Evidence；
- 失败必须绑定 Failure Classification、最后 Attempt、Finding 和可保留 Artifact；
- 取消必须停止继续派发，并保存已经产生的 Commit、Patch 和 Artifact；
- Blocking Finding、Docs Impact 和预算处置均有明确结论；
- Closure 生成不可变 CoreClosureResult 和 Closure Digest；
- 重复 Close 命令返回同一 Result，不产生第二个终态；
- 外层 Merge、Archive 或 Board 失败不得改写已确认的 Core Outcome。

### CORE-REQ-08：故障矩阵与收敛验收（横切，P0）

**目标**：用故障注入证明 Core 的恢复与唯一收敛，而不是只跑 Happy Path。

**最小矩阵**：

| 故障点 | 必须得到的结果 |
|---|---|
| Orchestrator Decision 返回前 Worker 退出 | 重放后最多持久化一个 Decision |
| Docs / Implementation / Review Agent 启动后结果未知 | 不盲目启动第二 Run；先对账 Artifact |
| Implementation Agent 明确失败 | 旧 Attempt 终结，按预算创建 Attempt N+1 或失败收束 |
| Review 产生 Blocking Finding | 不进入成功 Verification；Repair 后重新 Review |
| Verification 失败 | 根据分类 Repair、Replan 或失败收束 |
| Replan | Spec Revision 增加，旧 Evidence 不再满足新 Gate |
| Observer 退出 | 主流程继续，Observer 可从 Event/Artifact 重建报告 |
| Docs Impact 校验失败 | Core 停在可恢复 Gate，不伪装为 CLOSED |
| Close 回执丢失 | 重放得到同一 Closure Digest |
| 预算耗尽 | 唯一 `FAILED_TERMINAL`，不继续调用模型 |

每个场景必须能从 `task_id` 找到 Workflow、Decision、Attempt、Agent Session、Artifact、Finding、Verification、Docs Impact 和最终 Closure Result。

## 8. 状态与失败语义

本需求不强制最终枚举名称，但至少要表达以下稳定语义：

```text
RUNNING
  ├─ WAITING_RECONCILE
  ├─ WAITING_HUMAN
  ├─ CLOSING
  └─ CLOSED

CLOSED.outcome
  ├─ SUCCEEDED
  ├─ FAILED_TERMINAL
  └─ CANCELLED
```

`FAILED_TERMINAL` 是业务结论，不等于 Workflow 进程异常；`WAITING_RECONCILE` 不是失败终态；Observer、Board 和 Archive 状态必须与 Core Outcome 正交。

## 9. 实施切片

需求建议拆成以下顺序，每个切片都必须保持主干可验证：

### Slice 1：Control Kernel

- 定义 ControlDecision；
- 把固定 Workflow 阶段改成基于 Projection 的合法转换；
- 先用 Deterministic/Fake Orchestrator 验证，不立即依赖真实模型；
- 覆盖重复、过期和非法 Decision。

### Slice 2：Role Agent Runtime

- 泛化当前 AgentRunRequest；
- 接入 Docs、Implementation、Review Role；
- 固定角色 Artifact Schema；
- 保持单 Active Attempt。

### Slice 3：Review 与 Finding

- Self Review；
- Review Agent；
- ReviewFinding 生命周期；
- Blocking Gate。

### Slice 4：Repair / Replan Loop

- Finding 分类；
- Attempt N+1；
- Spec Revision 与 Evidence 失效；
- 统一预算和 UNKNOWN Reconcile。

### Slice 5：Observer 与 Knowledge Sync

- 只读 Observer 输入；
- Trace/Cost/Alert/Knowledge Candidate；
- Coding Docs Impact Gate；
- Document Graph 与 Validator 复用。

### Slice 6：Closure 与故障矩阵

- 三种 Outcome；
- CoreClosureResult；
- 失败/取消收束；
- 全边界 Worker Kill、重复投递和回执丢失测试。

## 10. 完成定义

本母需求只有在以下证据同时存在时才算被完整消费：

- 六个 Slice 均绑定 Backlog 和 Active Task；
- 真实 Restate 下成功、Repair、Replan、UNKNOWN、预算耗尽、取消和 Worker 重启场景通过；
- 已确认的 Agent Run 不重复；
- 每个 Role Attempt 和 Finding 可从 Task Trace 查询；
- Docs Impact Gate 使用最终 changed paths 通过；
- 成功、失败和取消各产生一个唯一 CoreClosureResult；
- 当前 CodeMap、Architecture 和相关 ADR 已完成影响判断；
- 新 Agent 只读取 Task Package、Projection、Artifact 和本文即可继续实现，不依赖历史聊天。

## 11. Backlog 提升建议

现有 Backlog 的复用关系：

| 需求 | 现有 Backlog | 处理建议 |
|---|---|---|
| CORE-REQ-04 | [BL-0003](../../delivery/backlog/BL-0003.yaml) | 收窄为单机 Core Repair/Replan/预算，删除对多 Daemon 的前置依赖 |
| CORE-REQ-05 | [BL-0006](../../delivery/backlog/BL-0006.yaml) | 只消费 Core Trace、成本和异常部分，生产运营平台后置 |
| CORE-REQ-05/06 | [BL-0007](../../delivery/backlog/BL-0007.yaml) | 先实现候选生成与文档 Gate，自动效果反馈后置 |

仍需新增并去重的 Backlog：

- Orchestrator ControlDecision 与状态校验；
- 多 Role Agent Attempt 协议；
- Self Review、Review Agent 与 Finding；
- Coding Docs Impact 集成；
- 统一 Core Closure Gate 与故障矩阵。

创建 Backlog 时只保存问题、优先级、来源和粗验收方向；完整需求继续稳定引用本文，不复制整篇内容。

## 12. 与旧文档的关系

[Task 全生命周期与 Worktree 收束](./task-lifecycle-and-worktree-convergence.md)保留为历史讨论和未来完整 Harness 的参考，但不再作为当前 Core 的需求入口。其 `REQ-LC-01` 至 `REQ-LC-07` 混入了统一 Task 入口、Workspace Finalize、归档和外围 Harness，已不符合当前 Core First 的优先级。

当前实施应以本文的 `CORE-REQ-01` 至 `CORE-REQ-08` 为母需求，再由 Backlog、Active Task Spec、Architecture 和 ADR 分别固化调度、实现和正式设计。
