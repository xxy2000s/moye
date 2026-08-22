# CodeMap

> 状态：Current  
> 更新日期：2026-08-22

本文件映射当前已经存在并通过测试的代码，不描述未来平台。

## 运行入口

| 入口 | 职责 | 状态所有权 |
|---|---|---|
| `src/index.ts` | 同时启动 Restate HTTP/2 Endpoint 和 Board HTTP Server | 无 |
| `src/cli/index.ts` | backlog sync、validate、route、TaskAuthority-aware create/status/wait、close、archive、reconcile-task、graph | 只提交/查询或解析显式 Reconcile Signal，不直接改 Projection |
| `src/restate/services.ts` | TaskAuthority、TaskWorkflow、ArchiveWorkflow、ProjectBoard | Authority 冻结并查询主 Workflow；Workflow 拥有 Task/Archive 流转 |
| `src/restate/coding-services.ts` | CodingTaskWorkflow、Board 映射、Spec Revision 主权更新、Durable Reconcile Signal、成功/失败 Archive 子流程 | Workflow 独占 Coding Projection |
| `src/restate/core-services.ts` | CoreClosureWorkflow 与只读 status | Workflow 独占 Core Projection；Scenario Adapter 只返回可验证 Artifact |
| `src/product/live-task.ts` | 校验 CLI/API 真实任务、仓库白名单与 Git refs，并冻结真实多角色 Coding Workflow 输入 | 不推进状态；只构造提交材料；产品入口拒绝 Fake |
| `src/review/live-review.ts` | 调用独立 Codex/Claude 只读 Review，生成结构化 Verdict、Finding 和 Artifact | 不推进状态；Workflow 消费已验证结果 |
| `src/trace/state-machine.ts`、`coding-trace.ts`、`telemetry.ts` | Coding/通用 Task Projection 到状态机 Definition/History、三层 Trace、稳定 OTel Span 与恢复建议的纯映射 | 无，只读派生；`TraceSink` 默认 Noop |
| `src/demo/coding-fixture.ts`、`scripts/demo.ts`、`scripts/trace-compose.ts` | 隔离 Git Fixture、Fake/真实 CLI 可选 Demo 与可选 Phoenix 编排 | 不拥有生产状态；演示状态由 CodingTaskWorkflow 持有 |
| `public/index.html`、`public/app.js` | 四列只读项目看板、居中且画布优先的 Task Audit Workspace、Definition/History/Executions 驱动的完整 SVG 状态机 Graph、按节点聚合 Event/Attempt/Run/Session/Evidence 与系统事实的桌面 Inspector/移动 Bottom Sheet，以及全 Session 共用的 Chatbot Event Dialog | 只读 Projection；视觉布局、筛选、折叠和 Dialog 都不创建或推进状态 |

## 模块图

```text
src/
├── agent/             Coding AgentRunner、真实 Live Role Runner、Core Role 协议、Fake/Codex/Claude Print 与 Artifact Bundle
├── backlog/           Git Backlog 文档加载、严格转换与批次摘要
├── coding/            真实多角色编码、Repair/Replan/Reconcile、成功/失败归档的 Workflow 编排与 Projection
├── core/              多角色 Core 确定性场景编排与内容寻址 Scenario Artifact 对账
├── demo/              隔离 Coding Demo Fixture 与安全清理
├── domain/            纯领域状态、错误、Backlog、Board、Core Reducer、Observer、Docs Impact 与 Review/Finding Gate
├── archive/           Manifest、Bootstrap 关闭材料、原子移动与 Reconcile
├── effects/           带稳定 operation ledger 的幂等副作用样例
├── git/               Worktree、Checkpoint 与本地 Git Effect 对账
├── product/           页面真实任务的输入校验、仓库边界与冻结输入构造
├── review/            独立真实 CLI Review、结构化 Finding 与 Artifact 对账
├── verification/      argv-only Verification Gate 与 Commit Binding
├── restate/           Durable Workflow、Projection、HTTP Ingress client
├── trace/             三层 Trace、稳定关联 ID、Noop/OTLP Sink 与恢复建议派生
├── board/             Board API 与静态资源服务
├── cli/               人和 Agent 的命令入口
├── config.ts          环境变量配置
└── index.ts           进程入口

public/                无框架 Board UI
compose.yaml           可选 Phoenix trace Profile，不是核心运行依赖
tests/
├── unit/              领域、归档、投影和幂等副作用
└── e2e/               真实 Restate 容器 + SIGKILL 恢复
.agents/skills/
└── moye-task-control/ 项目 Task/文档控制 Skill
scripts/
├── demo.ts            一键启动 Restate、Moye、隔离 Fake/真实 CLI Coding Task 和 Board
├── live_product_acceptance.ts  经统一 CLI 提交真实 Codex 多 Session Task，并验收 API Fake 拒绝、CLI wait、Merge 与 Archive
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
- `domain/review-finding.ts` 固定 Self Review、Candidate-bound Review Input、成功 ReviewResult、独立执行失败、Finding 稳定身份/追加处置和 Blocking Gate；Core 只接受绑定最近 Review Manifest Digest 的可信 Gate Result；
- `core/workflow.ts` 用确定性 Scenario Adapter 贯通线性成功、Repair、Replan、UNKNOWN→Reconcile、预算终止和取消；`core/scenario-artifact.ts` 在昂贵执行前写稳定 Intent，复用已确认结果并把仅有 Intent 的情况停为 UNKNOWN；
- `agent/role-runner.ts` 为确定性 Core PoC 提供统一角色协议；`agent/live-role.ts` 为 Coding 产品 Context、Self Review、Replan、Docs Gate 提供真实只读 CLI Session、结构化 Finding、稳定 Intent/Manifest 与原始事件；
- `agent/runner.ts` 规范请求、验证 Worktree/Git common dir、运行中 JSONL Stream 与最终 Artifact；`codex-exec.ts` 以 `workspace-write + --add-dir <validated-git-common-dir>` 允许真实 commit，`claude-print.ts` 维持自己的 argv-only 边界；两者只把 stdout chunk 交给行边界写入器，不推进 Task 状态；Claude 原生 OTel/内容采集只注入当前子进程，默认关闭；
- `product/live-task.ts` 只接受 `CODEX_EXEC | CLAUDE_PRINT`，在进入 Runtime 前拒绝 Fake、越界仓库、非 Git 仓库和冲突 ref；它创建受管 Task Package、Artifact Root、Worktree Root 与冻结 Envelope；
- `review/live-review.ts` 使用与 Implementation 独立的 CLI Session 和只读权限生成结构化 Verdict/Finding；Intent 已存在而 Manifest 缺失时返回 UNKNOWN，不盲目重跑；
- `backlog/document-sync.ts` 先验证全部 YAML，再形成单个 ProjectBoard 批次；
- `archive/file-archive.ts` 只依赖领域输入和文件系统；自举关闭模块还调用本地 Git、Ruby 文档门禁和 Task Artifact Resolver；
- `git/workspace-effect.ts` 通过 argv-only Git Adapter 管理隔离 Worktree；写操作前后都以 Branch、Worktree HEAD 和 ancestry 对账，Checkpoint 固定 Commit 与 Tree Object ID；
- `coding/workflow.ts` 编排产品主路径并记录 Spec Revision/Step/Attempt/Role Session/Evidence/Binding；Blocking Finding 按 Recommended Action 创建 Repair Generation N+1 或 Replan Envelope Revision N+1，后续 Checkpoint/Verification 绑定新 Revision；未知外部结果等待 Durable Reconcile Signal；确定性成功/失败都进入 Archive；
- `TaskAuthority` 保证同一 Task 只能由一个主 Workflow 推进，并允许相同 Coding owner 单调提升 Spec Revision；ProjectBoard 是二级查询投影；
- `CoreClosureWorkflow/<task_id>` 通过 `ctx.run` 调用 Scenario Artifact Adapter，持久化 `EXECUTING → CLOSED` 查询投影；它不把 Board、Archive、Observer 或外层 Merge 状态写进 Core Outcome；
- Board 通过 `TaskAuthority.get` 解析主 Workflow，不扫描目录推断 Runtime 状态；`state-machine.ts` 只从连续 Event History 标记实际 traversed 边，并列出 Repair/Replan/Reconcile/Failure/Archive 合法边、Projection/Event 一致性和全部执行实例；`public/app.js` 把同一事实投影为居中的 SVG Graph Workspace，默认不打开节点详情，节点 Inspector 以稳定 Step 映射聚合 Event、Step Attempt、Role/Agent/Review Run、Session、Evidence、Verification、Git、Recovery 和 Archive 事实，未进入节点保持零执行记录；桌面 Inspector/移动 Bottom Sheet、实际路径抽屉、筛选、缩放和焦点返回均为只读浏览状态；`/agent-events` 与 `/roles/<run-id>/events` 可增量读取当前 Implementation/Role/Review，完成后按摘要读取任一 Session，均校验 Projection allowlist、Execution Intent、受管根和 realpath；所有 Session 入口复用同一个 Chatbot Event Dialog，原始 JSON/JSONL 是次要证据动作；Board 无状态写入口；
- `telemetry.ts` 从持久化 Attempt 生成短 Span 并输出标准 OTLP/HTTP protobuf；导出失败只影响诊断，不回写 Task 业务终态；
- Restate Journal 是运行时恢复事实，`docs/delivery/tasks` 是研发材料事实。

## 高风险路径与测试

| 路径 | 风险 | 证据 |
|---|---|---|
| `src/archive/file-archive.ts` | 未知移动结果、路径逃逸、双目录冲突 | `tests/unit/file-archive.test.ts`、E2E |
| `src/agent/runner.ts`、`live-role.ts`、`role-runner.ts`、`codex-exec.ts`、`claude-print.ts` | Agent/Role Run 重复调用、角色 Schema/Producer 篡改、未知结果盲重试、chunk 边界丢行、JSONL 伪造、敏感内容误采集、Raw API 目录逃逸、Shell 注入 | Agent/Role/Codex/Claude unit + 受控流/真实 Codex 多 Session Acceptance |
| `src/archive/bootstrap-closure.ts`、`task-artifacts.ts` | 自举证据与提交不一致、归档后引用失效 | `tests/unit/bootstrap-closure.test.ts` |
| `src/backlog/document-sync.ts` | 坏条目部分写入、枚举漂移、无意义重复同步 | `tests/unit/backlog-sync.test.ts`、真实 Restate E2E |
| `src/domain/coding-task.ts` | Spec 漂移后沿用旧证据、Attempt 被复活、Shell 命令边界丢失 | `tests/unit/coding-task.test.ts` |
| `src/domain/core-control.ts`、`core-observer.ts`、`core-docs-impact.ts`、`core-closure.ts`、`review-finding.ts` | 过期 Decision、跨 Revision Attempt 碰撞、恢复动作混淆、UNKNOWN 盲重试、Observer 越权、Trace 漏证据、失败 Docs Gate 误关闭、冲突 Closure、预算无限循环 | Core Control/Recovery/Observer/Docs/Closure、Role/Review unit |
| `src/core/workflow.ts`、`src/core/scenario-artifact.ts`、`src/restate/core-services.ts` | 已确认昂贵场景重复、Intent-only 盲重试、Worker 退出后重复结果、回执丢失产生第二个 Closure | Core Workflow unit + 真实 Restate 六场景/异步回执/SIGKILL E2E |
| `src/git/workspace-effect.ts` | 路径/符号链接逃逸、Base 漂移、分支冲突、未知 Git 结果重复写 | `tests/unit/workspace-effect.test.ts` |
| `src/product/live-task.ts`、`src/review/live-review.ts`、`src/agent/live-role.ts` | Fake 混入产品入口、仓库越界、ref 冲突、角色 Session 混用、Finding 未触发 Repair/Replan、未知结果盲重跑 | Live Task/Role unit + `npm run acceptance:live` 真实 Codex Context/Implementation/Self Review/Review/Docs Gate 验收 |
| `src/coding/workflow.ts`、`src/trace/state-machine.ts`、`src/verification/gate.ts`、`src/git/merge-effect.ts` | Event 倒序补写、Repair 复用旧 Attempt、虚构 traversed 边、Gate 重放、Commit 漂移、Expected Base TOCTOU、状态越权、未知 Agent/Workspace/Merge 误判 | Coding/State Machine unit + Worker restart/unknown Merge Restate E2E + Codex Fixture evidence |
| `src/effects/counter.ts` | Step 确认前中断造成副作用重复 | `tests/unit/counter.test.ts`、E2E 计数断言 |
| `src/restate/services.ts` | 重放、错误分类、投影漂移 | `tests/e2e/restate-recovery.test.ts` |
| `src/trace/coding-trace.ts`、`telemetry.ts`、`src/board/server.ts` | 状态源混淆、OTLP 关联漂移、UNKNOWN 恢复建议越权、Artifact/静态路径逃逸 | Trace/OTLP/Board unit + Coding/Legacy Restate E2E、只读派生、realpath + digest 校验 |
| `src/demo/coding-fixture.ts`、`scripts/demo.ts` | 演示误改真实仓库、缺少 Coding 证据、残留 Worktree 或容器 | Demo Fixture unit + 真实 Restate Demo E2E |
| `docs/graph.yaml` | 入口遗漏与关联文档漏更新 | `scripts/docs_graph.rb validate[-impact]` |

模块新增、移动、状态所有者改变或高风险副作用变化时必须同步更新本文件。
