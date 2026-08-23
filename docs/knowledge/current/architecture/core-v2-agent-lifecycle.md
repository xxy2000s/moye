# Core v2 Agent Lifecycle

> 状态：Current / unified product Workflow implemented
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

该 Runtime 是角色执行与恢复底座，不拥有 Task 主状态，也不自行调度下一阶段。`CoreV2Workflow/<task_id>` 是统一产品编排者：它逐阶段创建 Attempt，在 Restate durable journal 中调用真实 Runtime，把结果交给纯 Lifecycle Reducer，并向 ProjectBoard 发布同一 Projection。

`src/domain/core-v2-lifecycle.ts` 已接入第一段 Workflow Reducer：成功 ARCHITECT Attempt 原子生成同 Revision 的 Spec/Design/Plan，随后只接受独立 `REVIEW/DESIGN_REVIEW` Attempt。Design Review 只能判断当前 Spec/Design/Plan；Implementation 尚未发生以及 Candidate、测试、Merge、Closure、Archive 尚不存在不能成为本 Phase 的 Finding。Review `PASSED` 才进入 Implementation；`FINDINGS` 进入 `REPLAN_REQUIRED`，提升到 R+1 并把旧 Revision 的四个 Artifact ref 显式记录为 invalidated。Role Attempt ID 使用可嵌入 Artifact Producer 的稳定 segment；单个 Architect Attempt 的三项产物使用 `ARCHITECT` phase。

Implementation 阶段只接受 Workflow 当前授权 Generation 的成功 `IMPLEMENTATION` Attempt。每次结果形成 append-only Checkpoint，绑定实现前基线、Candidate Commit、Git tree、测试 Evidence 与结构化 Self Review。`PASSED` 进入 Documentation；`FINDINGS` 进入 `REPAIR_REQUIRED`，只有显式 Repair 授权才能创建 Generation N+1。Repair 会把旧 Candidate、Checkpoint Digest、下游 Artifact refs、Trusted Test ref 与原因写入 `invalidatedGenerations`；所有真实测试执行同时追加到 `trustedTestRuns`。活跃 Gate 只读当前 Generation Artifact，但旧 Checkpoint、失败测试和 Review Evidence 仍可查询，永不复活、覆盖或冒充新 Gate Evidence。

Documentation 阶段只接受绑定当前 Candidate Commit 和 Implementation Generation 的成功 Attempt。通过 Router、Graph 与 Impact Gate 的摘要形成 `DOCS_IMPACT` Artifact，并精确依赖当前 Revision 的 Spec/Design；Agent 的自然语言声明本身不能推进到 Test Plan。

Test/Verification 使用两个隔离只读 Attempt：`TEST_PLAN` 形成 Requirement/Case/argv 映射；`TEST_ASSESSMENT` 只能在真实 Trusted Runner Manifest 已记录后形成综合报告。`src/testing/trusted-test-runner.ts` 先持久化 Intent，再以 `shell:false` 执行命令并保存退出码和 stdout/stderr 原始文件字节 SHA-256；Manifest 复用或 CONFIRMED 对账会重新读取文件校验 Digest。恢复时发现 Intent-only 必须返回 UNKNOWN，不启动第二次命令。PASS、FINDINGS、INCONCLUSIVE 分别路由到 Final Review、Repair、`WAITING_RECONCILE`。

真实恢复验收使用窄化的 `recoveryControl`，并且只在显式开启的专用 acceptance Service 中生效。Trusted Runner 可在 Intent 已持久化但命令未执行，或命令和 Manifest 已完成但 Workflow 尚未确认的边界终止 Service；前者只能经正确 token 的 `NOT_APPLIED` 授权唯一首次执行，后者只能用同一 Manifest 的 `CONFIRMED` 对账。相同 Evidence 重放幂等，错误 token 和冲突 Evidence 均拒绝。Role Manifest、Candidate Commit 或 Merge ref 已完成后的 Service 中断由 Restate 重放同一 command，并从内容寻址 Manifest、Git parent/tree/trailer/clean worktree 或 Merge DAG/target ref 对账，不能创建第二次 Agent Run、测试、Candidate 或 Merge。

Final Review 是第二次隔离 `REVIEW` Attempt，精确依赖 Docs Impact 和 Test Report。它审查 Candidate 与 Merge 前证据；目标 ref 更新由其后的 Verification Gate 授权，不能因尚未执行 Merge 而形成 Finding。PASSED 之后仍需纯 Verification Gate 重建八类主流程 Artifact、完整依赖和 Task/Revision/Commit/Digest 绑定；Gate Digest 写入 Projection 后才进入真实 Merge Effect。Review 的文字 verdict 不能替代 Gate。

`src/domain/core-v2-observer.ts` 从 Lifecycle Projection 与 Role Attempt 重建事件、Artifact、Session、失败、Repair、Replan、UNKNOWN 和告警事实，不写主状态。Replan 后它同时接受当前 Revision 和 `invalidatedRevisions` 明确登记的历史 Attempt，其他 Task、未来 Revision 或未登记 Revision 仍被拒绝。Knowledge Disposition 是 append-only Lifecycle Artifact；智能 Observer 不可用时 Workflow 可记录 deferred，主流程状态保持不变。

## 5. Artifact 与 Gate

每个 Artifact 绑定 Task ID、Spec Revision、Step/Attempt、Producer、Candidate Commit 和 Content Digest。旧 Revision Evidence 永远不能满足新 Gate。Agent Verdict 只是建议；Workflow 只有在确定性 Gate 校验全部绑定后才推进。

当前 `src/domain/lifecycle-artifact.ts` 已冻结九类一等 Artifact：`SPEC`、`DESIGN`、`PLAN`、`DOCS_IMPACT`、`TEST_PLAN`、`TEST_REPORT`、`DESIGN_REVIEW`、`FINAL_REVIEW` 和 `KNOWLEDGE_DISPOSITION`。公共 Envelope 固定 Task/Revision、Subject Commit、Producer Role/Phase、Attempt/Generation/Session、Dependency refs、Content Digest 与 Artifact Digest；Parser 从未信任 JSON 重建并重算摘要。

Dependency policy 是角色交接协议而非自由引用：Design 依赖 Spec；Plan 依赖 Spec + Design；Design Review 依赖三项 Architect 产物；Test Plan 依赖 Spec + Design；Test Report 依赖 Test Plan；Final Review 依赖 Docs Impact + Test Report。Review Subject Digest 由完整依赖集合计算；Test Report 的 `PASS` 只有在覆盖每个 Test Case 且全部 `PASSED` 时成立。Gate 必须同时解析依赖链并按 Task/Revision/Kind/Subject Commit/Artifact Digest 精确匹配，形状正确但未解析到真实 Artifact 的 ref 不能通过。

## 6. 单 Result Commit Seal

Git 中的 Task package 使用两阶段 Seal：Workflow 先发布 Seal Intent并等待；最终 Result Commit 同时包含代码、文档和位于 Archive 路径的 sealed package；Workflow 再验证 Commit 并发布 `CLOSED/ARCHIVED`。目录位置只是 Seal Evidence，不是业务状态，避免在 Commit 后由 Runtime 改写文件造成 SHA 循环。

Seal 协议已经由 `SealedTaskWorkflow`、统一 CLI、Board/Trace 查询和真实 Git + Restate 强杀恢复 E2E 实现。Core v2 产品路径由 `core-v2-start` 发起、`core-v2-status` 查询；它串联 Architect、Design Review、Implementation、Documentation、Test Plan、Trusted Runner、Test Assessment、Final Review、确定性 Gate、Knowledge Disposition、Merge、Closure 与 Archive。这里的完整串联只代表状态机和 Happy Path 已接通，不代表每个异常分支都已有真实 Agent 产品验收。

Implementation Agent 只修改受管 Workspace 并运行检查；Codex sandbox 不拥有 Git 元数据写权限。Workflow 随后执行带 `Moye-Task` 和 `Moye-Generation` 标记的幂等 Git checkpoint：首次创建 Candidate Commit，重放时校验 parent、message、clean tree 后复用同一 Commit。Documentation 首版审计已提交 Candidate，不在 Gate 后再产生隐藏 Commit。

Test Agent 提出 Requirement 覆盖和 Case 意图；Workflow 为每条预授权 argv 生成稳定 Case ID、约束合法类别并覆盖无效自然语言形状，Trusted Runner 只执行冻结输入中的 argv。Agent Verdict 仍不能代替 Runner Manifest 或 Verification Gate。

## 7. 成功/失败 Closure 与历史 successor

成功路径在 Verification Gate 与真实 Merge Receipt 确认后，先在 Task namespace 持久化不可变 Success Closure Artifact，绑定当前 Revision/Generation、Candidate、Merge、Gate、Knowledge Disposition、Attempt 与 Session；随后进入独立 `ARCHIVE_PENDING | ARCHIVE_FAILED | ARCHIVED`。Board 只能读取 Lifecycle Archive Receipt，不能再由 `state === CLOSED` 推导归档。Archive 失败只等待同一 Effect token；正确 signal 只增加 Archive attempt，不重新调用任何 Agent、Trusted Runner、Checkpoint、Gate 或 Merge。

不可恢复错误或预算耗尽首先冻结 `FAILED_TERMINAL` 的原阶段、原因、source Workflow ref、source Projection Digest、Attempt ID 与 Session ID。Workflow 随后在 `<artifactRoot>/<taskId>/...` 命名空间持久化 Failure Artifact，记录 Knowledge Disposition，形成不可变 Failure Closure，再进入独立的 `ARCHIVE_PENDING | ARCHIVE_FAILED | ARCHIVED`。Archive Effect 的 identity 由 Task、Revision 与 Closure Digest 决定；Archive 失败时原 Workflow 保持运行并等待同一 token，只允许 Archive-only retry，不能重新进入 Implementation、Test 或 Merge。

旧版本已完成在 `FAILED_TERMINAL + NOT_READY` 的 Workflow 不能改写。`CoreV2FailureRecoveryWorkflow/<task_id>` 先校验原 Projection Digest，再通过 `TaskAuthority.beginCoreV2FailureRecovery` 原子登记唯一 append-only successor；successor 复制原 Attempt、Session 与 Event 引用，只追加 Failure Closure/Archive 事实。仍停在 journaled durable Run 的 Workflow 必须先 pause；`core-v2-recovery-plan` 从 Restate Admin 核验 Invocation target/status、最后 command/index/failure digest 和 Projection digest。若 root recovery 自身在 Authority 前失败，只能以新的 `CoreV2FailureRecoveryAttemptWorkflow/<recovery_id>` 绑定前序 completed Failure Invocation 继续。Board、CLI 与 Trace 解析 Authority 指向最新 successor，直接查询原 key 仍得到摘要不变的原历史。

截至 2026-08-23，真实证据分级如下：LIVE-005/006 和 TASK-0043 Happy Task 证明真实 Agent Happy Path；LIVE-001～004 证明真实历史 Agent 失败经合法 Restate successor 归档；三个暂停 durable command 的原 Workflow 由绑定 Invocation/Projection fact 的 successor 收敛且原摘要保持不变；`TASK-CORE-V2-MERGE-UNKNOWN-005` 证明真实七 Role、Trusted Runner、Verification Gate、双父 Merge Commit 以及 ref 更新后进程终止的 `ALREADY_APPLIED` 对账；TASK-0043 的五个独立故障 Task 证明 Implementation Self Review、Final Review、Documentation、Test Failure 驱动 Repair，以及 Design Review 驱动 Replan，旧 Generation/Revision Evidence 保留但不能进入新 Gate；TASK-0044 的五个独立恢复 Task 证明 Test `UNKNOWN → CONFIRMED | NOT_APPLIED`、Architect/Implementation/Final Review Manifest 后 Worker 中断、Candidate Commit 回执未知和 Merge ref 更新回执未知均能恢复为唯一结果。Repair/Replan 预算耗尽、Observer/Knowledge 故障与 stale Attempt 仍未完成同等级矩阵，不能宣称 Core 完全闭环。

Board 的 `CORE_V2` Trace 从 Lifecycle Event、Attempt、Session、Artifact 和确定性 Observer 重建主流程、成功/失败 Closure、successor Recovery Record 与 Archive 状态，以及 Happy Path、Repair/Replan/Reconcile/Failure/Archive 合法边。节点 Inspector 直接关联真实 Role Event；Event 在 Chatbot 弹窗中按对话、工具调用、工具结果、系统和错误筛选，不提供跳转下载入口。
