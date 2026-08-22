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

## 4. 统一 Role Runtime v2

`src/domain/role-runtime-v2.ts` 已实现五类主 Agent 与旁路 Observer 共用的执行协议。Role/Phase 是固定矩阵；Architect、Test/Verification、两次 Review 与 Observer 保持只读，Implementation 和 Documentation 才能获得受管 Workspace Write。产品 Runner 枚举只有 `CODEX_EXEC | CLAUDE_PRINT`，`FAKE` 不属于该协议。

每次角色执行是内容寻址的 `RoleAttemptV2`，固定 Task、Spec Revision、Role、Phase、Generation、Runner、Permission、Input Artifact refs、Subject Commit 和连续 Event。Attempt 只能 `SCHEDULED → RUNNING → SUCCEEDED | FAILED`，或从 `RUNNING → WAITING_RECONCILE`；终态不能复活。只有失败且已经证明 `NOT_APPLIED` 的 UNKNOWN Attempt 才授权 Workflow 创建 Generation N+1。

`src/agent/role-runtime-v2.ts` 是真实进程 Adapter：先把稳定 `execution-intent.json` 写到 Scope 外的受管 Artifact Root，再用 `shell:false` 的 argv 启动 Codex/Claude。Session、原始 JSONL Event、stderr、结构化 Output、Manifest 和各文件摘要都持久化。完整 Manifest 会逐字段绑定 Attempt/Run/Evidence 并重算文件摘要后复用；仅有 Intent 时返回 `UNKNOWN_SIDE_EFFECT` 与领域统一 Reconcile Token，绝不自动启动第二个进程。`CONFIRMED` 必须提供同一 Run 的 Evidence，`NOT_APPLIED` 必须提供外部对账说明。

该 Runtime 是角色执行与恢复底座，不拥有 Task 主状态，也不自行调度下一阶段。各角色接入 keyed Workflow 的阶段、Gate 与修复路径仍由 TASK-0033 至 TASK-0038 逐步完成。

## 5. Artifact 与 Gate

每个 Artifact 绑定 Task ID、Spec Revision、Step/Attempt、Producer、Candidate Commit 和 Content Digest。旧 Revision Evidence 永远不能满足新 Gate。Agent Verdict 只是建议；Workflow 只有在确定性 Gate 校验全部绑定后才推进。

当前 `src/domain/lifecycle-artifact.ts` 已冻结九类一等 Artifact：`SPEC`、`DESIGN`、`PLAN`、`DOCS_IMPACT`、`TEST_PLAN`、`TEST_REPORT`、`DESIGN_REVIEW`、`FINAL_REVIEW` 和 `KNOWLEDGE_DISPOSITION`。公共 Envelope 固定 Task/Revision、Subject Commit、Producer Role/Phase、Attempt/Generation/Session、Dependency refs、Content Digest 与 Artifact Digest；Parser 从未信任 JSON 重建并重算摘要。

Dependency policy 是角色交接协议而非自由引用：Design 依赖 Spec；Plan 依赖 Spec + Design；Design Review 依赖三项 Architect 产物；Test Plan 依赖 Spec + Design；Test Report 依赖 Test Plan；Final Review 依赖 Docs Impact + Test Report。Review Subject Digest 由完整依赖集合计算；Test Report 的 `PASS` 只有在覆盖每个 Test Case 且全部 `PASSED` 时成立。Gate 必须同时解析依赖链并按 Task/Revision/Kind/Subject Commit/Artifact Digest 精确匹配，形状正确但未解析到真实 Artifact 的 ref 不能通过。

## 6. 单 Result Commit Seal

Git 中的 Task package 使用两阶段 Seal：Workflow 先发布 Seal Intent并等待；最终 Result Commit 同时包含代码、文档和位于 Archive 路径的 sealed package；Workflow 再验证 Commit 并发布 `CLOSED/ARCHIVED`。目录位置只是 Seal Evidence，不是业务状态，避免在 Commit 后由 Runtime 改写文件造成 SHA 循环。

Seal 协议已经由 `SealedTaskWorkflow`、统一 CLI、Board/Trace 查询和真实 Git + Restate 强杀恢复 E2E 实现。统一 Role Runtime 已可执行五类主角色和旁路 Observer，但完整产品 Workflow 仍按 [Core v2 Roadmap](../../../delivery/core-v2-roadmap.md) 逐 Task 接入；本文件不把“Runtime 可执行”误写成“阶段已接线”。
