# CodeMap

> 状态：Current  
> 更新日期：2026-08-20

本文件映射当前已经存在并通过测试的代码，不描述未来平台。

## 运行入口

| 入口 | 职责 | 状态所有权 |
|---|---|---|
| `src/index.ts` | 同时启动 Restate HTTP/2 Endpoint 和 Board HTTP Server | 无 |
| `src/cli/index.ts` | backlog sync、validate、route、status、create、close、archive、reconcile、graph | 只提交/查询 |
| `src/restate/services.ts` | TaskWorkflow、ArchiveWorkflow、ProjectBoard | Workflow 拥有 Task/Archive 流转 |
| `public/index.html` | 四列项目看板与 Task 详情 | 只读 Projection |

## 模块图

```text
src/
├── backlog/           Git Backlog 文档加载、严格转换与批次摘要
├── domain/            纯领域状态、错误、Backlog 和 Board 分类
├── archive/           Manifest、Bootstrap 关闭材料、原子移动与 Reconcile
├── effects/           带稳定 operation ledger 的幂等副作用样例
├── restate/           Durable Workflow、Projection、HTTP Ingress client
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
- `backlog/document-sync.ts` 先验证全部 YAML，再形成单个 ProjectBoard 批次；
- `archive/file-archive.ts` 只依赖领域输入和文件系统；自举关闭模块还调用本地 Git、Ruby 文档门禁和 Task Artifact Resolver；
- 只有 `restate/services.ts` 推进 Task/Archive 状态；
- Board 和 CLI 不扫描目录推断 Runtime 状态；
- Restate Journal 是运行时恢复事实，`docs/delivery/tasks` 是研发材料事实。

## 高风险路径与测试

| 路径 | 风险 | 证据 |
|---|---|---|
| `src/archive/file-archive.ts` | 未知移动结果、路径逃逸、双目录冲突 | `tests/unit/file-archive.test.ts`、E2E |
| `src/archive/bootstrap-closure.ts`、`task-artifacts.ts` | 自举证据与提交不一致、归档后引用失效 | `tests/unit/bootstrap-closure.test.ts` |
| `src/backlog/document-sync.ts` | 坏条目部分写入、枚举漂移、无意义重复同步 | `tests/unit/backlog-sync.test.ts`、真实 Restate E2E |
| `src/effects/counter.ts` | Step 确认前中断造成副作用重复 | `tests/unit/counter.test.ts`、E2E 计数断言 |
| `src/restate/services.ts` | 重放、错误分类、投影漂移 | `tests/e2e/restate-recovery.test.ts` |
| `src/board/server.ts` | 静态路径越界、请求体失控 | 直接子路径约束、1 MiB 限制、类型检查 |
| `docs/graph.yaml` | 入口遗漏与关联文档漏更新 | `scripts/docs_graph.rb validate[-impact]` |

模块新增、移动、状态所有者改变或高风险副作用变化时必须同步更新本文件。
