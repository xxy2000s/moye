# Moye 外部项目框架化需求基线

> 文档类型：Brainstorm / Product Requirement
> 状态：Draft / Partially consumed
> 提出日期：2026-08-25
> 正式消费方：[BL-0068](../../delivery/backlog/BL-0068.yaml)

## 1. 产品目标

Moye 的主要产品定位不是只服务自身仓库，而是作为开发框架管理其他项目的完整研发 Task：从自然语言需求进入，经架构、实现、文档、独立测试与 Review，最终形成可恢复、可审计、唯一关闭和归档的结果。

目标使用者不应修改 Moye 源码，也不应理解 Restate Workflow Input、Artifact Root、内部 Reconcile handler 或 Runtime Projection 才能提交普通研发任务。

## 2. 当前能力判断

当前 Core v2 已经是可运行的 Framework Kernel：真实产品验收使用独立本地 Git Fixture，证明外部仓库可以经过真实 Codex、Restate、Trusted Runner、本地 Git Merge、Closure 和 Archive。该证据允许声明“受控本地环境中的外部仓库闭环已跑通”。

当前仍不是可直接交付的 Framework Product，主要缺少：

1. 可安装、可升级的 CLI 与 Moye Service 分发物；
2. 外部项目的稳定 Manifest、Schema、初始化和诊断入口；
3. 隐藏内部 Workflow 字段的消费级 Task API；
4. 版本化 Agent、Workspace、Test、Documentation、SCM、Artifact 与 Knowledge Adapter 契约；
5. 不依赖 Moye 自身文档目录的可配置 Documentation Policy 和确定性 Gate；
6. Node、Python 等真实样例项目和跨项目产品验收；
7. 远程 Git/PR、多 Daemon、鉴权、多租户、Sandbox/Secrets、跨节点 Artifact Store 和生产运维能力。

因此当前产品分级是：

- 本机 Clone Moye、手工配置环境并提交 JSON 管理另一个本地仓库：基本可用；
- 其他项目通过稳定 CLI/配置直接接入：尚不可用；
- 多团队、多租户、远程 SCM 的生产平台：尚不可用。

## 3. 建议产品形态

首个框架版本以 **Moye Service + CLI** 为主，不把 Runtime 直接嵌入每个业务项目：

```text
External Repository
  └── .moye/project.yaml
          │
          ▼
Moye CLI / Client
          │
          ▼
Moye Service + Restate
          │
          ├── Agent Runner Adapter
          ├── Workspace Adapter
          ├── Trusted Test Adapter
          ├── Documentation Policy / Gate
          ├── SCM Adapter
          └── Artifact / Knowledge Adapter
```

Workflow 继续是 Task 主状态的唯一所有者；CLI、SDK、Plugin 和项目 Manifest 只构建合法命令和读取事实，不能形成第二套状态机。

## 4. Framework MVP 范围

### 4.1 项目 Manifest 与消费级 CLI

- 定义版本化 `.moye/project.yaml` 和 JSON Schema；
- 配置 Project ID、Repository、Base/Target Ref、Agent Runner、受信任测试命令、文档策略、Workflow Profile、Artifact 策略和安全边界；
- 提供 `moye init`、`moye doctor`、`moye project validate`；
- 提供 `moye task start/status/watch/open`；
- CLI 自动解析 Git HEAD、生成 Task ID、选择 Artifact Root、构建 Workflow Input 并返回 Board URL；
- 普通用户不手工填写 `baseCommit`、`artifactRoot` 或内部恢复字段。

### 4.2 稳定公共边界

候选包边界：

- `@moye/core`：稳定 Schema、Task/Event/Artifact 契约；
- `@moye/client`：提交、查询、事件和对账 Client；
- `@moye/cli`：消费级命令；
- `@moye/runtime-restate`：Restate Runtime 实现；
- `@moye/plugin-sdk`：Adapter 接口和契约测试工具。

包名仍需正式设计和 ADR 决策，本 Brainstorm 不直接冻结实现。

### 4.3 可替换项目策略

首版至少形成以下版本化接口：

- Agent Runner；
- Workspace/Git；
- Trusted Test Runner；
- Documentation Policy 与 Docs Impact Gate；
- SCM Provider；
- Artifact Store；
- Knowledge Sink。

Documentation Policy 至少支持 `none | conventional | moye-doc-graph | custom`。无论选择哪种策略，最终 Gate 必须产生真实确定性 Evidence，不能只相信 Agent 自报的摘要或 Digest。

### 4.4 分发、样例与验收

- 提供 Moye Service Dockerfile 和包含 Service/Restate 的 Compose；
- 提供可安装 CLI、版本锁定、健康检查和升级/迁移说明；
- 提供至少 Node/TypeScript、Python 和一个最小通用 Git Repository 示例；
- 建立 `Requirement → Project → Scenario → Execution → Evidence` 的外部项目验收矩阵；
- 示例项目不得依赖 Moye 源码目录或 Moye 自身 `docs/graph.yaml`；
- 验收必须覆盖 Happy、Repair、Reconcile、失败 Closure/Archive 和升级兼容，不得以 Fake/Mock 代替产品证据。

## 5. Framework MVP 完成定义

只有同时满足以下条件，才能声明“可作为开发框架给其他项目使用”：

1. 新项目无需修改 Moye 源码即可接入；
2. `moye init` 能生成可校验的版本化项目配置；
3. `moye doctor` 能检查 Git、Agent、Docker/Service、权限和测试命令；
4. 一条消费级命令可以启动真实 Task 并返回可追踪页面；
5. 使用者不需要构造 Restate Workflow Input；
6. Node 和 Python 示例项目都能完成真实成功闭环；
7. 至少一个 Repair/Reconcile 和一个失败归档场景在外部项目上通过；
8. 项目可以选择或替换测试、文档和 SCM 策略；
9. 配置、CLI/API 和 Plugin 契约都有版本与兼容策略；
10. Moye Service 有可重复部署和升级的分发物；
11. Moye 升级不破坏已运行 Workflow 或已有项目 Manifest；
12. README 明确区分 Framework MVP、受控本地能力和生产平台能力。

## 6. Framework MVP 之后的生产阶段

- GitHub/GitLab Push、PR、Review 与幂等 Merge/Reconcile；
- 多 Daemon 调度、Lease、完整 Fencing 和跨节点接管；
- Auth、RBAC、项目隔离、多租户和资源配额；
- 生产 Sandbox、Secrets、网络与工具权限策略；
- S3/MinIO 等跨节点 Artifact Store；
- Metrics、Logs、告警、SLO 与运营 Runbook；
- 插件发现、模板市场和长期 Knowledge 效果反馈。

这些能力不阻塞受控本地 Framework MVP，但必须继续明确标记为未实现，不能由本地 PoC 验收外推为生产完成。

## 7. 后续消费方式

本需求由 BL-0068 统一承接。开始长时开发前，应先把 BL-0068 拆成有依赖顺序的独立实现 Task，每个 Task 保持唯一 Result Commit；涉及公共兼容契约、包边界和升级策略的取舍进入 ADR，当前实现边界同步 Architecture、CodeMap、Runbook 和 README。
