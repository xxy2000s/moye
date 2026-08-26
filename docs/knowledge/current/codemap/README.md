# CodeMap

> 状态：Current  
> 更新日期：2026-08-25

本文件映射当前已经存在并通过测试的代码，不描述未来平台。

## 运行入口

| 入口 | 职责 | 状态所有权 |
|---|---|---|
| `src/index.ts` | 同时启动 Restate HTTP/2 Endpoint 和 Board HTTP Server | 无 |
| `src/cli/index.ts` | backlog sync（可显式选择 canonical `--id` 子集）、validate、route、TaskAuthority-aware create/status/wait、close、Bootstrap/Seal recovery、seal start/status/stage/submit、archive、reconcile-task、graph | 只提交/查询或解析显式 Seal/Recovery/Reconcile；`seal-start` 在发送前复用 Intent 校验器，`seal-submit` 本地验证 Commit 对象，`seal-stage` 只准备 Git package |
| `src/framework/project-manifest.ts`、`client.ts`、`doctor.ts`、`plugin-sdk.ts`、`builtin-adapters.ts`、`documentation-policy.ts`、`schemas/project.schema.json` | `.moye/project.yaml` v1、迁移、消费级 Task request/status/watch、Plugin API v1、七类内建 bridge、四种 Candidate-bound Docs Policy、Git/target/Artifact preflight 与 doctor | Client 单次提交 owning Workflow；Plugin/Docs Policy 只返回内容寻址 Result/Evidence，不暴露或写 Projection，不保存 Runtime token/内部 Workflow Input；默认不采集 Transcript |
| `scripts/core_v2_full_acceptance.ts`、`scripts/core_v2_*_acceptance.ts`、`src/acceptance/core-v2-matrix-*`、`src/acceptance/core-v2-session-evidence.ts`、`src/acceptance/restate-deployment-handoff.ts` | 16 场景真实产品矩阵、受控故障/恢复、默认 Role Session Evidence、显式 suite/scenario Manifest、实时交叉审计和临时 Deployment 安全回切 | 不扫描目录挑选结果；补跑必须显式绑定原场景根，re-audit 不提交 Workflow 或重跑副作用；临时 Service 退出前 PATCH 最新 Deployment URI 到仍运行的 predecessor |
| `scripts/session_timeline_acceptance.ts` | 附着显式真实 Core v2 Task，逐 Role 验证受管 Session metadata、canonical Timeline 分页、独立 execution stream 与 stderr | 只读；不提交 Workflow、不运行 Agent、不扫描 Provider Home 或验收目录 |
| `scripts/framework_client_acceptance.ts` | 从独立 Git 项目 Manifest 运行 doctor、消费级 Client、七 Role、Trusted Test、Merge、Closure 与 Archive | 真实产品 Task；显式 run root，不把首轮缺 target ref 的 backoff 计为修正版通过证据 |
| `scripts/plugin_sdk_contracts.ts` | 对七类内建 Adapter bridge 执行统一 descriptor、权限、capability、execute/reconcile export 契约检查 | 不运行 Workflow、不推进 Task；行为幂等和 UNKNOWN token 由同一公共 contract suite 单元验收 |
| `scripts/documentation_policy_acceptance.ts` | 无 Document Graph 的独立 Git 项目通过 Client 运行真实七 Role、policy:none、Trusted Test、Merge、Closure/Archive | 显式读取 Generation 0 Policy Evidence；不扫描或补造 Docs Impact，不把 Agent 自报当确定性 Gate |
| `scripts/agent_session_full_acceptance.ts` | 串行聚合真实 Codex/Claude、显式 Session Capture Recovery、历史 Enrichment 与 Board API 产品证据 | Recovery/Provider resume 必须由调用方给出精确 summary；重算受管 Manifest/Digest，不扫描目录选择结果，不推进 Task |
| `src/restate/services.ts`、`src/restate/core-v2-services.ts`、`src/restate/invocation-inspector.ts` | TaskAuthority、Task/Sealed/Core v2 Workflow、Bootstrap/Seal/Core v2 Failure Recovery、Archive 与 ProjectBoard | Core v2 replay-sensitive 输入在既有首个 durable Run 固化；Inspector 只接受 paused durable Run 或精确 index-1 HandlerReturn 570 mismatch，Authority 冻结 append-only successor chain |
| `src/restate/coding-services.ts` | CodingTaskWorkflow、Board 映射、Spec Revision 主权更新、Durable Reconcile Signal、成功/失败 Archive 子流程 | Workflow 独占 Coding Projection |
| `src/restate/core-services.ts` | CoreClosureWorkflow 与只读 status | Workflow 独占 Core Projection；Scenario Adapter 只返回可验证 Artifact |
| `src/product/live-task.ts` | 校验 CLI/API 真实任务、仓库白名单与 Git refs，并冻结真实多角色 Coding Workflow 输入 | 不推进状态；只构造提交材料；产品入口拒绝 Fake |
| `src/review/live-review.ts` | 调用独立 Codex/Claude 只读 Review，生成结构化 Verdict、Finding 和 Artifact | 不推进状态；Workflow 消费已验证结果 |
| `src/trace/state-machine.ts`、`coding-trace.ts`、`telemetry.ts` | Coding/通用 Task Projection 到状态机 Definition/History、三层 Trace、稳定 OTel Span 与恢复建议的纯映射 | 无，只读派生；`TraceSink` 默认 Noop |
| `src/demo/coding-fixture.ts`、`scripts/demo.ts`、`scripts/trace-compose.ts` | 隔离 Git Fixture、Fake/真实 CLI 可选 Demo 与可选 Phoenix 编排 | 不拥有生产状态；演示状态由 CodingTaskWorkflow 持有 |
| `src/domain/board.ts`、`src/board/server.ts`、`src/board/session-timeline.ts`、`public/index.html`、`public/app.js` | `/` 四列只读项目看板、紧凑 Backlog 卡片与问题详情 Dialog、Task Audit Page、状态机与 Execution Ledger；Board API 分离 execution stream、canonical normalized transcript、raw metadata 与 stderr，并只从 Projection 绑定的受管 Artifact 读取 | Workflow 发布精确运行元数据；Backlog 详情直接消费 ProjectBoard Projection；Board 校验 allowlist/binding/digest，只读浏览，不扫描 Git/Provider Home、不创建或推进 Task |
| `Dockerfile`、`compose.yaml`、`src/runtime/**`、`scripts/runtime-{compose,backup}.ts` | 非 root Service 镜像、Service+Restate+registrar 编排、健康/就绪、双卷备份恢复和固定镜像升级/回滚 | Journal/Artifact 分卷持久化；默认 loopback；删除数据需要显式确认 |
| `src/public/**`、`src/release/{manifest,publish}.ts`、`scripts/release_{verify,publish,snapshot_acceptance}.ts`、`tsconfig.package.json`、`.github/workflows/ci.yml` | 消费级 CLI 与三个 npm exports、最小发布编译闭包、Release Identity、clean-install/容器/SBOM、append-only 外部 publish/reconcile 和 CI | exports 不暴露 Runtime 状态写入口；release verify 要求 clean commit；Git/GitHub/npm/container 逐目标对账且冲突 fail closed |
| `examples/**`、`scripts/external_examples_acceptance.ts` | Node/TypeScript、Python、Minimal Git 三个独立消费 fixture 与 tarball-only smoke | 不 import Moye 源码/Document Graph；完整 Runtime 场景由 W09 执行 |
| `scripts/framework_product_matrix.ts` | W09 统一外部产品矩阵编排、Evidence 复用、专用 Service、自举跨版本 snapshot 与 clean release | 调用真实 Core v2 suites；不实现第二套 Workflow 状态机 |
| `scripts/core_v2_{acceptance,recovery_acceptance,guards_acceptance}.ts` | 参数化 Node/Python/Minimal Git fixture 与真实 Agent/Runner 故障场景 | Test argv、Reviewer contract 与 Evidence 同源；Recovery 只消费正式 token/manifest |

## 模块图

```text
src/
├── acceptance/        Core v2 产品矩阵显式 Manifest、场景专属 Evidence 与 Document Graph fail-closed 审计
├── agent/             Coding AgentRunner、真实 Live Role Runner、Core Role 协议、Fake/Codex/Claude Print 与 Artifact Bundle
├── backlog/           Git Backlog 文档加载、严格转换与批次摘要
├── coding/            真实多角色编码、Repair/Replan/Reconcile、成功/失败归档的 Workflow 编排与 Projection
├── core/              多角色 Core 确定性场景编排与内容寻址 Scenario Artifact 对账
├── demo/              隔离 Coding Demo Fixture 与安全清理
├── domain/            纯领域状态、错误、Backlog、Board、Core Reducer、Observer、Docs Impact 与 Review/Finding Gate
├── archive/           Manifest、Bootstrap 关闭材料、两阶段 Sealed Result Commit、原子移动与 Reconcile
├── effects/           带稳定 operation ledger 的幂等副作用样例
├── framework/         外部项目 Manifest、公共版本与消费级信任边界
├── git/               Worktree、Checkpoint 与本地 Git Effect 对账
├── product/           页面真实任务的输入校验、仓库边界与冻结输入构造
├── review/            独立真实 CLI Review、结构化 Finding 与 Artifact 对账
├── verification/      argv-only Verification Gate 与 Commit Binding
├── restate/           Durable Workflow、Projection、HTTP Ingress client
├── runtime/           Deployment 注册、Runtime 运维计划与备份 Manifest 验证
├── public/            npm 消费级 Core/Client/Plugin SDK facade 与独立 CLI
├── release/           版本、Git、tarball、image、Schema、SBOM Manifest 与外部发布 Intent/Event 协议
├── trace/             三层 Trace、稳定关联 ID、Noop/OTLP Sink 与恢复建议派生
├── board/             Board API 与静态资源服务
├── cli/               人和 Agent 的命令入口
├── config.ts          环境变量配置
└── index.ts           进程入口

public/                无框架 Board UI
examples/              只消费发布包的 Node、Python 与通用 Git 外部项目模板
Dockerfile             可分发的非 root Moye Service 镜像
compose.yaml           Service+Restate+registrar 双卷 Runtime 与可选 Phoenix trace Profile
tests/
├── unit/              领域、归档、投影和幂等副作用
└── e2e/               真实 Restate 容器 + SIGKILL 恢复
.agents/skills/
└── moye-task-control/ 项目 Task/文档控制 Skill
scripts/
├── demo.ts            一键启动 Restate、Moye、隔离 Fake/真实 CLI Coding Task 和 Board
├── live_product_acceptance.ts  经统一 CLI 提交真实 Codex 多 Session Task，并验收 API Fake 拒绝、CLI wait、Merge 与 Archive
├── core_v2_acceptance.ts  为每个 Happy/Finding/Repair/Replan 场景创建独立真实 CoreV2Workflow、Git/Artifact Root，并审计 Role/Test/Gate/Merge/Closure/Archive Evidence
├── core_v2_recovery_acceptance.ts  为 Test UNKNOWN、Role Worker 中断、Checkpoint/Merge 回执未知创建独立真实 Task，控制 Service 重启并审计唯一副作用
├── core_v2_guards_acceptance.ts  为 Repair/Replan 预算、智能 Observer 超时和旧 Generation/Revision fencing 创建独立真实 Task并审计终态
├── core_v2_matrix_audit.ts  只读取显式 suite/scenario，实时交叉检查 Restate、Board、Git、Artifact 与文档归档图并输出内容寻址报告
├── runtime-compose.ts  argv-only Compose 生命周期、日志、固定镜像升级/回滚与显式 purge
├── runtime-backup.ts   停写窗口双卷备份、Digest 校验与 empty-target restore
├── runtime_distribution_acceptance.ts  真实镜像、注册、Task、重启、备份与 Projection 一致性验收
├── release_verify.ts  clean commit 的 npm pack/install、CLI/exports、Docker、SBOM 与 Release Manifest 验证
├── release_publish.ts  对 Git Tag、GitHub Release、npm 与容器 Registry 执行 Intent-first publish/reconcile
├── release_snapshot_acceptance.ts  把当前实现复制为独立 clean commit 后执行相同 RC 流水线
├── trace-compose.ts   argv-only 启停可选 Phoenix Profile
├── codex_fixture_smoke.mjs  一次性真实 Codex Fixture（拒绝覆盖既有证据）
└── docs_graph.rb      文档校验、Context Route、Impact Gate、Mermaid
```

## 依赖方向

```text
UI / CLI
   ↓ HTTP Ingress
Restate Workflow ──更新──> ProjectBoard Projection
   ↓
Domain Rules + Archive/Effect Adapters
   ↓
Filesystem

docs_graph.rb <── moye-task-control Skill / CLI route
```

- `domain` 不依赖 Restate、HTTP 或浏览器；
- `domain/core-control.ts` 从已验证 TaskEnvelope 创建内容寻址 Core Projection 和 ControlDecision；唯一 Reducer 校验 Expected State/Version、Required Gate、单 Pending Role 与固定预算形状，分别持久化 Operation Retry、Role Attempt Retry、Finding-driven Repair、Spec Replan、Unknown Effect/Reconcile、Evidence Invalidation 和失败终态候选；
- `domain/core-observer.ts` 从 Core 只读事实重建 Trace/Usage/Recovery 摘要、Alert 与 `PROPOSED` Knowledge Candidate，不接收状态写入口；`domain/core-docs-impact.ts` 用 argv-only Ruby Adapter 刷新 Final Route、校验逐项 disposition/新 Markdown 注册并保存 Graph/Impact Gate 证据；
- `domain/core-closure.ts` 从已验证 Envelope、最终 Core Projection 与完整 Trace Index 推导 `SUCCEEDED | FAILED_TERMINAL | CANCELLED`，Closure 与 CLOSED Projection 均内容寻址且不可变；
- `domain/lifecycle-artifact.ts` 定义 Core v2 九类生命周期 Artifact、角色/Phase 权限、Revision/Commit/Producer/Attempt 绑定、固定依赖图、未信任 JSON 重建和精确 Artifact Set Gate；Review subject 与 Test Plan/Report coverage 都由确定性摘要校验，旧 Revision 或未解析 dependency 不能过 Gate；
- `domain/session-transcript.ts` 定义 Prompt Envelope、Active Role Run Locator、Provider-normalized Timeline、Transcript Manifest 与 append-only Import Receipt 的 v1 Sidecar 合同；它冻结 capture policy、Task/Attempt/Revision/Generation/Run/Session/Role Manifest binding、canonical Digest、stale fencing 和 `DIAGNOSTIC_SUPPLEMENT_ONLY` 权限，但不执行 Provider 文件读取、Workflow 推进或 Board 查询；`agent/codex-session-adapter.ts` 以确认的 `thread_id` 在显式 allowlist 内安全定位和稳定快照 Codex rollout；`agent/claude-session-adapter.ts` 以确认的 `sessionId` 读取 Claude Projects 主 Session，并把 user/text/thinking/tool_use/tool_result、uuid/parentUuid、agentId/sidechain 与模型元数据规范化。两个 Adapter 都使用内容一致的受管 raw/normalized/Manifest Artifact，允许脱离 Provider Home 后按 Digest 读取；
- `restate/transcript-enrichment-services.ts` 提供不推进 Task 的 `TranscriptEnrichmentWorkflow/<enrichment-id>` 和 `SessionEvidenceRegistry/<run-id>`：前者从 owning archived Core v2 Projection 生成不可由调用方伪造的 Historical Baseline、执行历史 Capture 并复核旧事实不变；后者以 Authority Version fencing 追加 Intent/Receipt/Manifest，提供显式只读 join；
- `board/session-timeline.ts` 是 Core v2 Session Evidence 的受管只读 resolver：先消费 Projection 内的 live Role Run/Locator/Authority/Receipt；旧 Run 没有 live record 时，由 `board/server.ts` 以精确 `runId` 查询 SessionEvidenceRegistry。两条路径都验证 Task/Attempt/Run/Manifest 绑定，只在 Board allowlist 内调用 Provider Adapter 的 managed inspect，分页返回唯一 canonical Timeline；raw 只返回 descriptor，execution events 与 stderr 维持独立端点和 Digest；
- `scripts/session_history_acceptance.ts` 是单 Task 的真实历史产品验收；`scripts/session_history_matrix.ts` 只接受显式 Task ID 列表并生成内容寻址汇总。两者只从 TaskAuthority/owning Workflow 的显式 Role Run 调度 enrichment，不以目录发现 Runtime 事实；保存 Task/Run/Attempt/Session、Receipt/Manifest/Source/Authority Digest、`COMPLETE | PARTIAL | UNAVAILABLE` disposition、Board Event 数量、幂等重放及原 Projection 不变证明；
- `domain/review-finding.ts` 固定 Self Review、Candidate-bound Review Input、成功 ReviewResult、独立执行失败、Finding 稳定身份/追加处置和 Blocking Gate；Core 只接受绑定最近 Review Manifest Digest 的可信 Gate Result；
- `core/workflow.ts` 用确定性 Scenario Adapter 贯通线性成功、Repair、Replan、UNKNOWN→Reconcile、预算终止和取消；`core/scenario-artifact.ts` 在昂贵执行前写稳定 Intent，复用已确认结果并把仅有 Intent 的情况停为 UNKNOWN；
- `domain/role-runtime-v2.ts` 定义 Core v2 六类 Role、隔离 Phase、固定权限、Attempt/Generation/Event、Run Evidence、唯一真实 Role Prompt renderer 和 UNKNOWN/Reconcile 领域协议；`agent/role-runtime-v2.ts` 复用该 renderer，先持久化 Intent，再以 argv-only 真实 Codex/Claude 进程生成 Session、原始 Event、stderr、结构化 Output 与逐文件摘要 Manifest；Claude 优先消费 CLI `structured_output`，完整结果可复用，Intent-only 禁止盲重跑；
- `domain/core-v2-lifecycle.ts` 是 Core v2 Lifecycle Reducer，覆盖 Architect/Design Review/REPLAN、Implementation Checkpoint/Repair、Documentation、两阶段 Test、Final Review、Verification Gate、Knowledge Disposition，以及成功/失败 Closure 与 Archive Pending/Failed/Archived；Repair Generation 绑定上一 Candidate，append-only `trustedTestRuns` 与 `invalidatedGenerations` 保留旧 Candidate/Checkpoint/Test/Artifact 失效关系，旧 Attempt 不可覆盖；
- `archive/core-v2-artifact-store.ts` 提供 Task namespace、content-checked pending/rename 和冲突拒绝；`core-v2-failure.ts`、`core-v2-success.ts` 分别持久化失败/成功 Closure 与 Archive Receipt。共享 Artifact Root 中的不同 Task 互不覆盖，相同 Task/Closure 只接受相同内容；
- `testing/trusted-test-runner.ts` 是 argv-only 真实测试执行 Effect Adapter，持久化 Intent、逐 Case 退出码/stdout/stderr 与 Manifest；文件 Digest 绑定原始 Evidence 字节，Manifest 复用会重新校验文件，在 Intent-only 恢复时返回 UNKNOWN；专用验收故障点可在 Intent 或 Manifest 边界终止进程，Trusted Runner 子进程以显式环境标识支持执行账本审计；
- `domain/core-v2-observer.ts` 是 Core v2 确定性只读投影，汇总 Lifecycle/Attempt 的 trace、失败、恢复和 UNKNOWN 事实；它接受当前 Revision 与 `invalidatedRevisions` 明确登记的历史 Attempt，仍拒绝其他 Task 或未登记 Revision；
- `acceptance/core-v2-matrix-audit.ts` 定义产品矩阵 Audit Manifest 与十四个执行场景 profile（预算场景同时覆盖 stale fencing）：Task/Workflow/Invocation、Revision/Generation、Role Attempt/Session/Event/Manifest、Trusted Test、Checkpoint/Merge、Gate/Knowledge/Closure/Archive 必须与实时 Restate/Board、真实 Git 与 Artifact 一致；脚本不发现目录，旧 summary、无显式 acceptance metadata、重复副作用、旧证据漂移或 Document Graph Active/Archive 漂移均 fail closed；
- `restate/core-v2-services.ts` 是 keyed `CoreV2Workflow` 产品编排：只由 Workflow 推进 Task，调用真实 Role Runtime、受信任 Test Runner、幂等 Git Candidate checkpoint、Verification Gate、可选只读 Observer/Knowledge、双父 Merge、成功/失败 Closure 与独立 Archive Effect，并同步 ProjectBoard；Role Intent-only 与 Test UNKNOWN 都发布正式 `WAITING_RECONCILE`，用绑定 operation/attempt/phase 的 token 接受 `CONFIRMED | NOT_APPLIED`，错误 token/冲突 Evidence 被拒绝且 NOT_APPLIED 不盲重跑；旁路 Agent 超时/失败映射为 `deferred` 且不阻塞，`auditAttemptFence` 只读比较已持久化 Manifest 的 Revision/Generation；Candidate、Merge 与 Archive 各自使用幂等可对账 Effect；`restate/invocation-inspector.ts` 从 Restate Admin 核验 append-only recovery successor fencing；
- `agent/role-runner.ts` 为确定性 Core PoC 提供旧统一角色协议；`agent/live-role.ts` 为 Coding 产品 Context、Self Review、Replan、Docs Gate 提供真实只读 CLI Session、结构化 Finding、稳定 Intent/Manifest 与原始事件；
- `agent/runner.ts` 规范请求、验证 Worktree/Git common dir、运行中 JSONL Stream 与最终 Artifact；`codex-exec.ts` 以 `workspace-write + --add-dir <validated-git-common-dir>` 允许真实 commit，`claude-print.ts` 维持自己的 argv-only 边界；两者只把 stdout chunk 交给行边界写入器，不推进 Task 状态；Claude 原生 OTel/内容采集只注入当前子进程，默认关闭；
- `product/live-task.ts` 只接受 `CODEX_EXEC | CLAUDE_PRINT`，在进入 Runtime 前拒绝 Fake、越界仓库、非 Git 仓库和冲突 ref；它创建受管 Task Package、Artifact Root、Worktree Root 与冻结 Envelope；
- `review/live-review.ts` 使用与 Implementation 独立的 CLI Session 和只读权限生成结构化 Verdict/Finding；Intent 已存在而 Manifest 缺失时返回 UNKNOWN，不盲目重跑；
- `backlog/document-sync.ts` 严格区分 v1 兼容读取与 v2 `problem` 合同；可对调用方显式 ID 子集做语法、重复、缺失与全文档验证，再形成单个 ProjectBoard 批次并保持 canonical source path；`domain/backlog.ts` 让 Projection 保存 schema、问题、影响范围和验收方向，Runtime 新建只接受完整 v2；
- `archive/file-archive.ts` 只依赖领域输入和文件系统；`bootstrap-closure.ts` 以同一基线检查支持 CLI/Workflow Preflight、最终 Gate、成功/失败 Artifact 和稳定写入；
- `archive/sealed-result-commit.ts` 从冻结 Base 和 Active manifest 生成内容寻址 Seal Intent；同一只读校验器由 CLI 派发前和 Workflow 第一条 durable command 调用。`seal-stage` 在移动 package 前即要求精确 Accepted Verification；普通 Gate 再校验唯一父提交、HEAD、clean worktree、Manifest/Intent、Accepted Verification、Docs Impact/changed paths。历史 Recovery Gate 额外要求 Result 是 HEAD 祖先，并在该 Commit 的 detached worktree 内验证当时的 Graph Revision，避免拿新图谱误判旧证据；
- `git/workspace-effect.ts` 通过 argv-only Git Adapter 管理隔离 Worktree；写操作前后都以 Branch、Worktree HEAD 和 ancestry 对账，Checkpoint 固定 Commit 与 Tree Object ID；
- `coding/workflow.ts` 编排产品主路径并记录 Spec Revision/Step/Attempt/Role Session/Evidence/Binding；Blocking Finding 按 Recommended Action 创建 Repair Generation N+1 或 Replan Envelope Revision N+1，后续 Checkpoint/Verification 绑定新 Revision；未知外部结果等待 Durable Reconcile Signal；确定性成功/失败都进入 Archive；
- `TaskAuthority` 保证同一 Task 只能由一个主 Workflow 推进，并允许相同 Coding owner 单调提升 Spec Revision；升级前遗留的已知 Bootstrap 故障只允许追加一次 recovery successor，原 Workflow 保持只读历史；ProjectBoard 是二级查询投影；
- `TaskAuthority` 让 CLI、Board Detail 和 Trace 精确查询主 Workflow 或合法 Recovery successor；Sealed Task 的 numbered Attempt 可从第一层 recovery 或前一 Attempt 继续任意长度 append-only 修正链；Core v2 首个 successor 使用 `CoreV2FailureRecoveryWorkflow`，只有核验前序 completed Failure Invocation 后才能用新的 `CoreV2FailureRecoveryAttemptWorkflow` 继续，source Invocation/Projection digest 与 predecessor fact 永久保留；
- `CoreClosureWorkflow/<task_id>` 通过 `ctx.run` 调用 Scenario Artifact Adapter，持久化 `EXECUTING → CLOSED` 查询投影；它不把 Board、Archive、Observer 或外层 Merge 状态写进 Core Outcome；
- Board 通过 `TaskAuthority.get` 解析主 Workflow，不扫描目录推断 Runtime 状态，也不再把 `CLOSED` 映射成虚构 `ARCHIVED`；`domain/board.ts` 规范化 `runtimeState/workflowKind/historyKind/historyKindSource`，当前 Core v2 Workflow 发布显式事实，遗留 Task 只由 Authority 和受限兼容约定补齐展示信息。`public/app.js` 在四列上按 outcome、Workflow 和历史类型本地筛选，并从 `SUCCEEDED + ARCHIVED` 计算最新成功直达，不写回 ProjectBoard。`state-machine.ts` 只从连续 Event History 标记实际 traversed 边，并列出 Repair/Replan/Reconcile/Failure/Archive 合法边、Projection/Event 一致性和全部执行实例。`CORE_V2` Trace 额外展示完整状态机、确定性 Observer、Lifecycle Artifact、真实 Role Session、原失败/Closure/Archive Receipt 与 successor Invocation 接管记录。Server 只对合法 `/tasks/<task_id>` 页面路由回退 SPA 入口，API/静态 404 保持不变；`public/app.js` 用 History API 在 `/` 与全屏 Task Page 间导航，直接刷新和浏览器 Back/Forward 均重查同一只读 Projection。Domain Event 以 sequence、历史绑定的 `来源 → 目标`、type/time/detail 时间线呈现，没有转换的 Event 不补造边。节点 Inspector 以稳定 Step 映射聚合 Event、Step Attempt、Role/Agent/Review Run、Session、Evidence、Verification、Git、Recovery 和 Archive 事实，并把合法入边/出边投影为显式标注“本次经过”或“合法但本次未发生”的扁平列表。有 Session 时先显示 Agent Activity、真实分类计数、末尾事件预览和完整 Session 主入口，再显示 Workflow 状态流转与系统控制；无 Session/未进入节点保持零 Agent/执行记录。桌面 Inspector/移动 Bottom Sheet、实际路径抽屉、筛选、缩放和焦点返回均为只读浏览状态；Core v2 Session Dialog 先读取 `/session` 状态与来源，再消费 `/timeline` canonical category/actor/origin/parts，独立合并 `/stderr` 诊断项，并按 Prompt/User、Assistant、Tool Call、Tool Result、System、Error/stderr 筛选；父子 Session、capture policy、completeness、Digest 和 raw descriptor 按需展开，raw 不跳转下载。旧 Workflow 没有 Session Evidence contract 时才进入明确标记的 Execution Stream 兼容视图；Board 无状态写入口；
- `public/app.js` 的 Backlog 卡片只呈现紧凑摘要，原生 Dialog 从同一 Backlog Projection 展示 `problem`、Evidence、affected areas、acceptance outline、source/digest 与 Task refs；缺省字段显示明确空值。初始加载、网络错误和空列表为互斥 UI 状态，恢复只重查 `/api/board`；Dialog 的 Escape、焦点返回、桌面双列与窄屏单列滚动都只存在于浏览器内存；
- `public/app.js` 的三类审计画布默认筛选实际路径，并分别使用 Core v2、Coding 与基础 Task 的紧凑几何：有 Recovery/Exception 的 Workflow 只用背景包围对应节点簇，基础 Task 不绘制不存在的黄色 Recovery 分区，Archive 独立成区且 Definition 保持完整。最小可读缩放、未发生节点降级和直接 Task 路由优先 Trace 均只存在于浏览器内存。节点 Inspector 当前依次呈现 Agent、系统管控、状态流转、本次路径、技术 Evidence 和完整合法转换；无 Agent 节点显示 Workflow/Gate/Runner/Git/Archive 系统所有权。Domain Event 先呈现业务摘要，原始 detail 单条按需展开；
- `public/app.js` 从 Board Task 的首条 Event 派生开始时间，只在 `ARCHIVED` 后用末条 Event 显示结束时间；未结束 Task 以 Board `generatedAt` 计算运行中 duration，不新增或回写 Projection 字段。三类 Task Trace 共用四个 ARIA Tab：画布默认直接进入 Graph，正常态只保留一致性标识，不一致时主动展开四项差异；完整业务/Archive/整体/Event 重建事实与 Domain Event 归入 Workflow Tab，Observer/Restate 诊断归入高级诊断。角色与交付物先归一化成只读 Execution Ledger：Core v2/Coding 桌面使用紧凑角色索引与单个选中详情，窄屏使用横向 tablist，完整技术标识、Artifact Register 和 Coding Journey 按需展开；基础/Sealed Task 只展示真实 Workflow、Result Commit、Task Package 与 Archive 系统事实，不补造 Agent。Session Dialog 在桌面使用居中高密度审计面板，窄屏变为接近全屏的单列布局；长正文、Evidence 与 metadata 分层展开，原生 dialog 负责 Escape 并把焦点还给来源按钮。角色选择和当前顶层 Tab 都在同 Task 自动刷新时保留，切换 Task 重置；左右键/Home/End、可见焦点和窄屏滚动均为浏览器内 UI 状态；
- `telemetry.ts` 从持久化 Attempt 生成短 Span 并输出标准 OTLP/HTTP protobuf；导出失败只影响诊断，不回写 Task 业务终态；
- Restate Journal/ProjectBoard Projection 是运行时恢复与页面查询事实，`docs/delivery/tasks` 是 Git 中的研发材料事实；Compose 命名卷持久化前者，二者没有显式导入协议时不能互相重建或冒充。

## 高风险路径与测试

| 路径 | 风险 | 证据 |
|---|---|---|
| `src/archive/file-archive.ts` | 未知移动结果、路径逃逸、双目录冲突 | `tests/unit/file-archive.test.ts`、E2E |
| `src/agent/runner.ts`、`live-role.ts`、`role-runner.ts`、`codex-exec.ts`、`claude-print.ts` | Agent/Role Run 重复调用、角色 Schema/Producer 篡改、未知结果盲重试、chunk 边界丢行、JSONL 伪造、敏感内容误采集、Raw API 目录逃逸、Shell 注入 | Agent/Role/Codex/Claude unit + 受控流/真实 Codex 多 Session Acceptance |
| `src/archive/bootstrap-closure.ts`、`task-artifacts.ts` | 自举基线派发过晚、证据与提交不一致、失败 Artifact 重放、归档后引用失效 | Bootstrap unit + 旧服务升级/真实 Restate E2E |
| `src/archive/sealed-result-commit.ts`、`src/restate/services.ts` | Commit 自引用、错误 Evidence、用当前 Graph 误判历史 Commit、successor 覆盖历史、Worker 等待时丢 Intent | Seal/recovery unit + 真实 Git/Restate SIGKILL/错误 Evidence E2E |
| `src/backlog/document-sync.ts`、`src/domain/backlog.ts` | v1/v2 漂移、problem 缺项、坏条目部分写入、摘要/所有权冲突、无意义重复同步 | `tests/unit/backlog-sync.test.ts`、真实 Restate E2E |
| `src/domain/coding-task.ts` | Spec 漂移后沿用旧证据、Attempt 被复活、Shell 命令边界丢失 | `tests/unit/coding-task.test.ts` |
| `src/domain/core-control.ts`、`core-observer.ts`、`core-docs-impact.ts`、`core-closure.ts`、`review-finding.ts` | 过期 Decision、跨 Revision Attempt 碰撞、恢复动作混淆、UNKNOWN 盲重试、Observer 越权、Trace 漏证据、失败 Docs Gate 误关闭、冲突 Closure、预算无限循环 | Core Control/Recovery/Observer/Docs/Closure、Role/Review unit |
| `src/domain/lifecycle-artifact.ts` | 聊天文本冒充产物、旧 Revision/Commit 证据复用、Digest 篡改、依赖 ref 伪造、Test Report 漏项 | Lifecycle Artifact unit + 完整九类交接链 E2E |
| `src/domain/session-transcript.ts`、`src/agent/codex-session-adapter.ts`、`src/agent/claude-session-adapter.ts`、`src/agent/session-capture-effect.ts`、`src/board/session-timeline.ts`、`src/restate/core-v2-services.ts`、`public/app.js` | Prompt/分类漂移、Provider Home 越界、受管 Artifact 冲突、Capture 丢回执后重跑 Agent、旧 Attempt 越界、Board 路径注入、Receipt/Manifest/stderr 篡改、canonical Timeline 被 execution stream 冒充 | Session Contract/Capture/Board resolver unit；真实 Provider/Capture 验收；`npm run acceptance:core-v2:session-api` 对 7 个真实 Role 做分页与独立流产品验收；TASK-0063 对真实 W04 Session 做桌面/窄屏、筛选、长内容、错误重试和键盘浏览器验收；历史导入由 M1-W07～W08 继续补齐 |
| `src/domain/role-runtime-v2.ts`、`src/agent/role-runtime-v2.ts` | Role/Phase 越权、Fake 混入产品协议、跨 Attempt Evidence、完整结果重复执行、Intent-only 盲重跑、Artifact 篡改 | Role Runtime v2 unit + 六类角色真实 OS 子进程/复用/UNKNOWN/Reconcile/篡改 E2E |
| `src/domain/core-v2-lifecycle.ts` | 角色越权、旧 Revision Artifact 复用、Finding 绕过 REPLAN/REPAIR、旧 Generation 覆盖、Projection 篡改 | Core v2 Lifecycle unit + 序列化 Architect/Review/Implementation/Repair E2E |
| `src/acceptance/core-v2-matrix-audit.ts`、`scripts/core_v2_matrix_audit.ts`、`scripts/core_v2_full_acceptance.ts` | 目录扫描误选历史结果、Workflow probe identity 钉住旧 Deployment、summary 自证、实时 Projection 漂移、重复 Session/Test/Commit/Merge、归档图谱漂移 | Matrix Manifest unit + 旧 14 场景 fail-closed 审计 + TASK-0048 16 场景零 Finding live audit |
| `src/core/workflow.ts`、`src/core/scenario-artifact.ts`、`src/restate/core-services.ts` | 已确认昂贵场景重复、Intent-only 盲重试、Worker 退出后重复结果、回执丢失产生第二个 Closure | Core Workflow unit + 真实 Restate 六场景/异步回执/SIGKILL E2E |
| `src/git/workspace-effect.ts` | 路径/符号链接逃逸、Base 漂移、分支冲突、未知 Git 结果重复写 | `tests/unit/workspace-effect.test.ts` |
| `src/product/live-task.ts`、`src/review/live-review.ts`、`src/agent/live-role.ts` | Fake 混入产品入口、仓库越界、ref 冲突、角色 Session 混用、Finding 未触发 Repair/Replan、未知结果盲重跑 | Live Task/Role unit + `npm run acceptance:live` 真实 Codex Context/Implementation/Self Review/Review/Docs Gate 验收 |
| `src/coding/workflow.ts`、`src/trace/state-machine.ts`、`src/verification/gate.ts`、`src/git/merge-effect.ts` | Event 倒序补写、Repair 复用旧 Attempt、虚构 traversed 边、Gate 重放、Commit 漂移、Expected Base TOCTOU、状态越权、未知 Agent/Workspace/Merge 误判 | Coding/State Machine unit + Worker restart/unknown Merge Restate E2E + Codex Fixture evidence |
| `src/effects/counter.ts` | Step 确认前中断造成副作用重复 | `tests/unit/counter.test.ts`、E2E 计数断言 |
| `src/restate/services.ts`、`src/restate/core-v2-services.ts`、`src/restate/invocation-inspector.ts` | 重放配置分叉、Journal mismatch、错误分类、Bootstrap 派发前污染、失败 successor 越权、投影漂移 | Core v2 Workflow/Invocation Inspector unit + `tests/e2e/restate-recovery.test.ts` + TASK-0061R1 真实 paused Invocation recovery |
| `src/trace/coding-trace.ts`、`telemetry.ts`、`src/board/server.ts` | 状态源混淆、OTLP 关联漂移、UNKNOWN 恢复建议越权、Artifact/静态路径逃逸 | Trace/OTLP/Board unit + Coding/Legacy Restate E2E、只读派生、realpath + digest 校验 |
| `src/demo/coding-fixture.ts`、`scripts/demo.ts` | 演示误改真实仓库、缺少 Coding 证据、残留 Worktree 或容器 | Demo Fixture unit + 真实 Restate Demo E2E |
| `docs/graph.yaml` | 入口遗漏与关联文档漏更新 | `scripts/docs_graph.rb validate[-impact]` |

模块新增、移动、状态所有者改变或高风险副作用变化时必须同步更新本文件。
