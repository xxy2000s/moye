# Core v2：5+1 Agent 研发闭环需求基线

> 文档类型：Brainstorm / Requirement Baseline  
> 状态：Draft / Partially consumed
> 基线日期：2026-08-23  
> 目标范围：单机、单仓库、单 Task、单主 Workflow、真实多 Agent 研发闭环  
> 取代范围：[旧多 Agent Core 闭环需求基线](./multi-agent-core-closure-requirements.md)中的角色划分与 Happy Path  
> 正式消费方：[Core v2 Delivery Roadmap](../../delivery/core-v2-roadmap.md)、[Core v2 Agent Lifecycle](../../knowledge/current/architecture/core-v2-agent-lifecycle.md)、[ADR-0005](../../knowledge/decisions/adr/0005-adopt-core-v2-five-plus-one-agent-model.md)、[TASK-0030](../../delivery/tasks/archive/2026-08-23-TASK-0030/spec.md)
> 剩余消费：TASK-0031 至 TASK-0039 负责把各角色接入统一产品 Workflow

本文保存已经确认的 Core v2 产品需求，但在 Architecture、ADR 和 Task Spec 消费前仍然只是 `idea-input`，不代表当前代码已经具备这些能力。

## 1. 目标角色模型

主流程必需五类 Agent：

1. `ARCHITECT`：读取需求和当前项目事实，形成带 Revision 的 Spec、Design 与执行 Plan；
2. `IMPLEMENTATION`：实现代码与测试，形成 Self Review 和可接管 Checkpoint；
3. `DOCUMENTATION`：把变更后的当前项目事实写入 Task、Architecture、CodeMap、Runbook 和 Docs Impact；
4. `TEST_VERIFICATION`：形成 Test Plan，分析 Trusted Runner 的真实证据，输出综合测试报告与建议；
5. `REVIEW`：使用隔离 Attempt 分别执行 Design Review 与 Final Review，不与实现上下文混用。

旁路可选一类 Agent：

6. `OBSERVER_KNOWLEDGE`：读取确定性 Observer 的事实，异步生成 Finding、Pitfall、Runbook、Backlog 和经验模式候选。它失败或缺席不能阻塞成功主流程。

`Verification Gate` 是确定性系统门禁，不是 Agent；`Trusted Runner` 是受控命令执行器，也不是 Agent；确定性 Observer 是 Event、Attempt、Session 和 Artifact 的投影，同样不是 Agent。

## 2. Documentation 与 Knowledge 边界

`DOCUMENTATION` 回答“本次变更后，项目当前事实应该怎么写”，可以在文档门禁约束下修改当前 Task 文档、Architecture、CodeMap、Runbook 和 Docs Impact。

`OBSERVER_KNOWLEDGE` 回答“本次执行产生了什么可供未来任务复用的经验”，只能先形成候选，不能直接把建议提升成 Accepted ADR，也不能覆盖 Architecture 当前事实。

Closure 必须保存 `none | proposed | deferred | applied` 中的一种 Knowledge Disposition；但不要求每个 Task 都产生知识候选，也不要求旁路 Agent 成功完成。

## 3. 测试与验证边界

`TEST_VERIFICATION` 必须独立于 Implementation。首版只读产品代码、请求受控测试并写 Artifact，不直接修改产品代码；测试或测试覆盖缺失时产生 Blocking Finding，回到 Implementation 补齐。

建议拆成两个隔离 Attempt：

```text
TEST_PLAN
  → Trusted Runner 执行 argv-only 命令并冻结 Evidence
  → TEST_ASSESSMENT
  → Verification Gate 校验证据绑定
```

综合测试报告至少包含：Task、Spec Revision、Candidate Commit、环境、Requirement → Test Case → Evidence 矩阵、实际命令与结果引用、单元/集成/E2E/回归/异常与恢复结果、未执行项、Finding、剩余风险、最终建议和 Evidence Digest。

Agent 只能建议 `PASS | FINDINGS | INCONCLUSIVE`；只有 Workflow 校验过的确定性 Verification Gate 才能允许主流程继续。

## 4. Happy Path

```text
Task Intake
→ Context Plan
→ ARCHITECT: Spec + Design + Plan
→ REVIEW / DESIGN_REVIEW
→ IMPLEMENTATION: Code + Tests + Self Review + Checkpoint
→ DOCUMENTATION: Project Docs + Docs Impact
→ TEST_VERIFICATION / TEST_PLAN
→ Trusted Runner: immutable command evidence
→ TEST_VERIFICATION / TEST_ASSESSMENT
→ REVIEW / FINAL_REVIEW
→ deterministic Verification Gate
→ Merge
→ Closure
→ Archive
```

`OBSERVER_KNOWLEDGE` 从 Intake 到 Archive 旁路观察，基于稳定 Digest 幂等生成候选。

## 5. 异常、返工与对账

```text
实现或测试缺陷
→ REPAIR
→ IMPLEMENTATION N+1
→ DOCUMENTATION N+1
→ TEST_PLAN / RUNNER / TEST_ASSESSMENT N+1
→ FINAL_REVIEW N+1

需求或设计缺陷
→ REPLAN
→ Spec Revision R+1
→ ARCHITECT N+1
→ DESIGN_REVIEW N+1
→ 后续所有依赖旧 Revision 的 Gate 重新执行

测试或外部副作用结果未知
→ WAITING_RECONCILE
→ 对账既有 Operation Intent / Artifact / 外部状态
→ 禁止启动第二次可能重复产生副作用的执行
```

Operation Retry、Attempt Retry、Repair 和 Replan 必须分别建模、分别计预算。旧 Attempt 终态不可复活，旧 Lease 或旧 Generation 的结果不能覆盖新 Attempt。

## 6. 权限与状态权威

- 只有 keyed Workflow 可以推进 Task 主状态；
- Agent 只提交建议、Artifact、Finding 和 Result，不直接关闭 Task；
- Trusted Runner 只执行 Workflow 批准的 argv，不接受 shell 字符串；
- Verification Gate 校验 Commit、Spec Revision、报告、Evidence 和 Digest 的绑定；
- Board、Trace、确定性 Observer 和 OBSERVER_KNOWLEDGE 都是只读派生或旁路产物；
- Agent、Daemon、进程内存、Prompt 和聊天历史都不是持久化 Task 状态。

## 7. 完成定义

Core v2 只有在以下事实由真实 Runtime 和 E2E 共同证明后才完成：

- 五类主流程 Agent 都通过统一真实 Runner 执行并产生独立 Attempt、Session、Event 和 Artifact；
- REVIEW 的两次 Attempt 与 TEST_VERIFICATION 的两个阶段可独立审计；
- Documentation 修改当前事实，Observer/Knowledge 只生成候选，且旁路失败不阻塞主流程；
- Happy Path、Repair、Replan、UNKNOWN/Reconcile、Worker 强杀、回执丢失、预算耗尽和旁路失败都唯一收敛；
- 从 `task_id` 可查到 Spec Revision、Workflow、Attempt、Agent Session、Tool Event、Artifact、Finding、Test Evidence、Review、Verification、Merge、Closure 和 Archive；
- CLI 可以发起、观察、对账、等待和查询全流程，不依赖 Web 端任务创建接口；
- 自动化验收不使用 Fake/Mock 证明产品能力；测试替身只能用于低层协议单测，并必须与真实 Runtime E2E 分开标识。

## 8. 非目标

- 多 Daemon 抢占、Lease/Fencing 和跨机器调度；
- 远程 Git Provider、PR/审批/发布；
- 企业权限、多租户和生产级 SLO；
- 看板视觉重构；
- 自动把知识候选提升成 Accepted ADR；
- 证明 Restate 是最终生产选型。
