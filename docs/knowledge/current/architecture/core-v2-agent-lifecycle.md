# Core v2 Agent Lifecycle

> 状态：Current / Agent lifecycle implementation in progress
> 更新日期：2026-08-23
> 决策：[ADR-0005](../../decisions/adr/0005-adopt-core-v2-five-plus-one-agent-model.md)、[ADR-0006](../../decisions/adr/0006-use-two-phase-sealed-result-commit.md)

## 1. 状态权威

Task 是完整研发生命周期聚合根，keyed Workflow 是主状态唯一写入者。Agent、Runner、Board、Trace、Observer、Git 目录和聊天历史都不能推进 Task。每次实际角色执行都是独立 Attempt；所有接管信息必须存在于 Event、TaskEnvelope、Checkpoint 和 Artifact。

## 2. 角色与权限

| 角色 | 主流程 | 可写范围 | 必需结果 |
|---|---|---|---|
| ARCHITECT | 是 | Spec/Design/Plan Artifact | Revision-bound Spec、Design、Plan |
| IMPLEMENTATION | 是 | 受管 Worktree、代码、测试、Checkpoint | Candidate Commit、Self Review |
| DOCUMENTATION | 是 | 当前项目文档与 Docs Impact | re-route、Graph/Impact evidence |
| TEST_VERIFICATION | 是 | Test Artifact；首版不写产品代码 | Test Plan、综合报告、建议 |
| REVIEW | 是 | Review/Finding Artifact | DESIGN_REVIEW 与 FINAL_REVIEW 隔离 Attempt |
| OBSERVER_KNOWLEDGE | 否 | 候选 Artifact | none/proposed/deferred/applied disposition |

Trusted Runner 只执行 Workflow 批准的 argv；Verification Gate 只校验 Evidence；确定性 Observer 只投影 Event/Attempt/Session/Artifact。三者都不是 Agent。

## 3. 主流程

```text
INTAKE → CONTEXT_PLAN
→ ARCHITECT → DESIGN_REVIEW
→ IMPLEMENTATION → DOCUMENTATION
→ TEST_PLAN → TRUSTED_RUNNER → TEST_ASSESSMENT
→ FINAL_REVIEW → VERIFICATION_GATE
→ MERGE → CLOSURE → ARCHIVE
```

实现/测试缺陷走 REPAIR 并重跑 Implementation 之后的依赖阶段；需求/设计缺陷走 REPLAN，提升 Spec Revision 并从 Architect 重跑；未知副作用进入 WAITING_RECONCILE。

## 4. Artifact 与 Gate

每个 Artifact 绑定 Task ID、Spec Revision、Step/Attempt、Producer、Candidate Commit 和 Content Digest。旧 Revision Evidence 永远不能满足新 Gate。Agent Verdict 只是建议；Workflow 只有在确定性 Gate 校验全部绑定后才推进。

## 5. 单 Result Commit Seal

Git 中的 Task package 使用两阶段 Seal：Workflow 先发布 Seal Intent并等待；最终 Result Commit 同时包含代码、文档和位于 Archive 路径的 sealed package；Workflow 再验证 Commit 并发布 `CLOSED/ARCHIVED`。目录位置只是 Seal Evidence，不是业务状态，避免在 Commit 后由 Runtime 改写文件造成 SHA 循环。

Seal 协议已经由 `SealedTaskWorkflow`、统一 CLI、Board/Trace 查询和真实 Git + Restate 强杀恢复 E2E 实现。五类主流程 Agent 与旁路 Observer/Knowledge 的统一产品 Workflow 仍按 [Core v2 Roadmap](../../../delivery/core-v2-roadmap.md) 逐 Task 接入；本文件不把 Planned Agent 误写为已接入产品 Workflow。
