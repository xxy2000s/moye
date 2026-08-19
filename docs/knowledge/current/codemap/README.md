# CodeMap

> 状态：Current  
> 更新日期：2026-08-20

本文件映射当前已经存在并通过测试的代码，不描述未来平台。

## 运行入口

| 入口 | 职责 | 状态所有权 |
|---|---|---|
| `src/index.ts` | 同时启动 Restate HTTP/2 Endpoint 和 Board HTTP Server | 无 |
| `src/cli/index.ts` | backlog sync、validate、route、status、create、close、archive、reconcile、graph | 只提交/查询 |
| `src/restate/services.ts` | TaskAuthority、TaskWorkflow、ArchiveWorkflow、ProjectBoard | Authority 冻结并查询主 Workflow；Workflow 拥有 Task/Archive 流转 |
| `src/restate/coding-services.ts` | CodingTaskWorkflow、Board 映射、Archive 子流程 | Workflow 独占 Coding Projection |
| `src/trace/coding-trace.ts` | Coding Projection 到三层 Trace 与恢复建议的纯映射 | 无，只读派生 |
| `public/index.html`、`public/app.js` | 四列项目看板、Task 详情与 Coding Trace | 只读 Projection |

## 模块图

```text
src/
├── agent/             AgentRunner、Fake Runner、Codex Exec 与 Artifact Bundle
├── backlog/           Git Backlog 文档加载、严格转换与批次摘要
├── coding/            八阶段单 Agent 编码 Workflow 编排与 Projection
├── domain/            纯领域状态、错误、Backlog 和 Board 分类
├── archive/           Manifest、Bootstrap 关闭材料、原子移动与 Reconcile
├── effects/           带稳定 operation ledger 的幂等副作用样例
├── git/               Worktree、Checkpoint 与本地 Git Effect 对账
├── verification/      argv-only Verification Gate 与 Commit Binding
├── restate/           Durable Workflow、Projection、HTTP Ingress client
├── trace/             业务/Journal/日志三层 Trace 与恢复建议派生
├── board/             Board API 与静态资源服务
├── cli/               人和 Agent 的命令入口
├── config.ts          环境变量配置
└── index.ts           进程入口

public/                无框架 Board UI
tests/
├── unit/              领域、归档、投影和幂等副作用
└── e2e/               真实 Restate 容器 + SIGKILL 恢复
.agents/skills/
└── moye-task-control/ 项目 Task/文档控制 Skill
scripts/
├── demo.mjs           一键启动 Restate、Moye、演示 Task 和 Board
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
- `agent/runner.ts` 规范请求、JSONL 与 Artifact；`agent/codex-exec.ts` 只负责 argv-only Codex 子进程，不推进 Task 状态；
- `backlog/document-sync.ts` 先验证全部 YAML，再形成单个 ProjectBoard 批次；
- `archive/file-archive.ts` 只依赖领域输入和文件系统；自举关闭模块还调用本地 Git、Ruby 文档门禁和 Task Artifact Resolver；
- `git/workspace-effect.ts` 通过 argv-only Git Adapter 管理隔离 Worktree；写操作前后都以 Branch、Worktree HEAD 和 ancestry 对账，Checkpoint 固定 Commit 与 Tree Object ID；
- `coding/workflow.ts` 编排固定八阶段并记录 Step/Attempt/Evidence/Binding；`verification/gate.ts` 用稳定 Intent 对账 Gate；`git/merge-effect.ts` 只接受可信 Binding 并以 ref CAS 发布唯一 Merge；
- `TaskAuthority` 保证同一 Task revision 只能由一个主 Workflow 推进；ProjectBoard 是二级查询投影；
- Board 通过 `TaskAuthority.get` 解析主 Workflow，不扫描目录推断 Runtime 状态；Coding Trace 只从主 Projection 派生；
- Restate Journal 是运行时恢复事实，`docs/delivery/tasks` 是研发材料事实。

## 高风险路径与测试

| 路径 | 风险 | 证据 |
|---|---|---|
| `src/archive/file-archive.ts` | 未知移动结果、路径逃逸、双目录冲突 | `tests/unit/file-archive.test.ts`、E2E |
| `src/agent/runner.ts`、`codex-exec.ts` | Agent 重复调用、JSONL 伪造、Artifact 路径/内容篡改、Shell 注入 | `tests/unit/agent-runner.test.ts` |
| `src/archive/bootstrap-closure.ts`、`task-artifacts.ts` | 自举证据与提交不一致、归档后引用失效 | `tests/unit/bootstrap-closure.test.ts` |
| `src/backlog/document-sync.ts` | 坏条目部分写入、枚举漂移、无意义重复同步 | `tests/unit/backlog-sync.test.ts`、真实 Restate E2E |
| `src/domain/coding-task.ts` | Spec 漂移后沿用旧证据、Attempt 被复活、Shell 命令边界丢失 | `tests/unit/coding-task.test.ts` |
| `src/git/workspace-effect.ts` | 路径/符号链接逃逸、Base 漂移、分支冲突、未知 Git 结果重复写 | `tests/unit/workspace-effect.test.ts` |
| `src/coding/workflow.ts`、`src/verification/gate.ts`、`src/git/merge-effect.ts` | Gate 重放、Commit 漂移、Expected Base TOCTOU、状态越权、未知 Agent/Workspace/Merge 误判 | Coding unit + Worker restart/unknown Merge Restate E2E + Codex Fixture evidence |
| `src/effects/counter.ts` | Step 确认前中断造成副作用重复 | `tests/unit/counter.test.ts`、E2E 计数断言 |
| `src/restate/services.ts` | 重放、错误分类、投影漂移 | `tests/e2e/restate-recovery.test.ts` |
| `src/trace/coding-trace.ts`、`src/board/server.ts` | 状态源混淆、错误 Workflow 查询、UNKNOWN 恢复建议越权、静态路径/符号链接逃逸 | Trace/Board unit + Coding/Legacy Restate E2E、只读派生、lexical + realpath containment、1 MiB 限制 |
| `docs/graph.yaml` | 入口遗漏与关联文档漏更新 | `scripts/docs_graph.rb validate[-impact]` |

模块新增、移动、状态所有者改变或高风险副作用变化时必须同步更新本文件。
