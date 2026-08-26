# Framework MVP 公共产品边界

> 文档类型：Architecture
> 状态：Current / Framework MVP 0.1.0 GA source accepted; public channels are receipt-dependent
> 版本：v0.1
> 更新日期：2026-08-25
> 决策依据：[ADR-0008](../../decisions/adr/0008-publish-framework-mvp-as-versioned-umbrella-package.md)

## 1. 边界

```text
External Git Repository
  └── .moye/project.yaml (schemaVersion: 1)
          ↓
  moye CLI / moye/client (apiVersion: 1)
          ↓ intent + public evidence
  Moye Service
          ↓ private workflow input
  Restate owning Workflow
          ↓
  versioned Adapter boundary (pluginApiVersion: 1)
```

公共入口只负责配置校验、意图提交、状态/事件查询、对账请求和页面链接。只有 owning Workflow 可以推进 Task 主状态。Plugin、CLI、Client、Board 和目录扫描都没有 Projection 写权限。

## 2. 公共与私有 API

| 边界 | Public | Private |
|---|---|---|
| Core | Project/Task/Event/Artifact Schema、版本与稳定错误 | reducer command、Projection 写入口、Authority claim |
| Client | start/status/watch/reconcile/open 的消费级请求 | Restate handler 名、Workflow Input、内部 token 结构 |
| CLI | `init`、`doctor`、`project validate`、`task *` | Artifact Root 选择、base SHA 冻结、Workflow dispatch 细节 |
| Plugin SDK | Adapter capability、Intent/Result/Evidence、contract suite | Task 状态迁移和 Runtime journal |
| Runtime | 同版本容器、健康/就绪、受控配置 | `src/restate/**` import、Projection 数据库、Worker 本机路径 |

## 3. 版本矩阵

产品首版为 `0.1.0`，Manifest/Client/Plugin 协议首版均为 `1`。同一产品 major 内支持当前和前一个 Manifest schema；历史 Artifact 按原版本只读。升级不能改写已归档 Evidence，也不能让运行中 Workflow 重跑已完成 Agent、测试、Commit、Merge 或发布 Effect。

## 4. 发布一致性

Release Manifest 把 Git Commit、npm tarball Digest、容器 Digest、Schema versions 和 channel 绑定为唯一 Release Identity。`ReleasePublishIntentV1` 再冻结 Git remote/tag、GitHub repository、npm integrity、容器 reference 与 Release Notes；四个外部目标分别追加 `NOT_APPLIED | CONFIRMED | BLOCKED_AUTH | UNKNOWN | CONFLICT` 观测。任何目标端回执未知都先 Reconcile；相同版本不同 Digest 是硬冲突。Git 中的 sealed Result Commit 不自引用发布回执，外部 Receipt 保存在受管 release evidence 中。

## 5. 当前实现状态

Project Manifest v1 已由 `src/framework/project-manifest.ts` 实现，并以 `schemas/project.schema.json` 分发机器可读 Schema。`init` 采用安全默认值且不覆盖，`project validate` 输出 canonical Digest；legacy v0 只有明确窄化结构可以迁移，未知/未来版本稳定拒绝。路径执行词法与真实路径边界检查，命令只接受 argv 并拒绝 shell、破坏性 executable 与 inline eval。

消费级 `MoyeClient` 与 CLI 已实现：公共 start request 只有 Manifest 路径、需求、验收标准和可选 Task ID；内部自动冻结 clean HEAD、存在且等于 base 的 target ref、测试 argv、Runner 和仓库外 Artifact namespace，再单次提交 keyed `CoreV2Workflow`。status/watch 每次经 TaskAuthority 附着 owning Workflow，open 只生成稳定 Board URL。doctor 只读检查 Manifest、Git、target、Agent、test executable、Artifact 权限、Docker、Restate 和 Board。

默认 Transcript policy 已收紧为 `none`；只有项目同时显式选择 `digest_only | full` 并允许 Prompt capture 时 Client 才构造 Session Evidence。`redacted` 仍未实现，不能静默降级。

Plugin SDK v1 已由 `src/framework/plugin-sdk.ts` 实现：七类 Adapter 共享版本化 Descriptor、Operation Context、内容寻址 `COMPLETE | UNKNOWN | FAILED` Result 和 capability negotiation。公共 Context 不包含 Projection、Reducer、Authority、Workflow dispatch 或 Runtime journal；相关 capability 前缀会被 fail closed 拒绝。`RECONCILABLE` Adapter 必须同时声明 `effect.reconcile` 和 handler，UNKNOWN token 绑定 operation/idempotency key/intent，重复 execute/reconcile 必须返回相同字节。

`src/framework/builtin-adapters.ts` 把现有 Agent Runner、Workspace/Git、Trusted Test、Docs Graph、Local SCM、Filesystem Artifact 和 Observer/Knowledge 实现登记为七个 bridge；统一契约入口会加载并验证真实 export，而不是给 Plugin 状态推进权限。当前只冻结 SDK 和内建 bridge，动态第三方代码加载、Sandbox/Secrets、市场和 owning Workflow 的可配置 dispatch 不在 W04 范围。

Documentation Policy v1 已实现 `none | conventional | moye-doc-graph | custom`。Client 把 Manifest policy 冻结到私有 Workflow Input；Core v2 在独立 Documentation Agent PASS 后执行确定性 Gate：先验证 clean worktree 与 HEAD=Candidate，再读取 `base..candidate` Git diff。`none` 记录 `NOT_REQUIRED`；`conventional` 在产品代码变化而没有项目事实文档变化时阻塞；Graph/custom 使用无 shell、受限输出和固定超时的 argv Runner。Evidence 绑定 Task/Revision/Generation/Base/Candidate/changed-files/command Digest，幂等写入 Artifact namespace，再成为 Final Review 依赖的 Docs Impact Payload。旧 Workflow Input 没有 policy 字段时保留 legacy command sequence，不在重放中插入新 durable step。

Runtime Distribution 已由 `Dockerfile + compose.yaml` 实现：固定 Node/Agent CLI/Git/Ruby 运行层以非 root 用户启动，Restate Journal 与 Moye Artifact 使用独立命名卷，Board/Ingress/Admin 默认仅绑定 loopback，Service Endpoint 只在内部网络提供给 Restate。一次性 registrar 在 `/readyz` 通过后注册 deployment；`/healthz` 与 `/readyz` 分别表达进程存活和 Restate 依赖可用。

运维入口提供 data-preserving stop/uninstall、日志、绑定稳定 Restate node name 的内容寻址双卷备份、empty-target restore、固定镜像 upgrade/rollback 和二次确认的 purge。真实容器验收 Task `TASK-RUNTIME-1787702994174` 在完整 stop/start、备份重启和跨 Compose project restore 后保持同一 Projection Digest，证明本地单节点持久化与可恢复性；它不证明 HA、远端 Artifact、生产密钥或灾备。

Package Pipeline 使用 `tsconfig.package.json` 从四个公共入口只编译最小传递闭包；npm `exports` 是可导入边界，tarball 审计同时拒绝 Workflow handler、Projection reducer、内部文档、测试与 Runtime 数据。`release:verify` 只接受 clean Git source，通过真实 `npm pack`、隔离 install、CLI/Schema/exports、Docker build、CycloneDX SBOM 和 canonical Release Manifest 绑定候选版本。开发中的 Task 使用独立 committed snapshot 运行同一流水线，避免把脏 HEAD 记录成 Release Commit。

`examples/node-typescript | python | minimal-git` 是可脱离仓库复制的消费 fixture：只包含项目相对 Manifest、业务代码/测试与发布 CLI 操作，不 import Moye source 或 Moye Document Graph。统一验收只从 W07 tarball 安装 CLI/包并在三个隔离 Git repo 执行 init、validate 和真实测试；完整 Agent/Repair/Reconcile/upgrade 场景属于 W09 产品矩阵。

包流水线与三个外部示例已由 TASK-0072～0073 验收。TASK-0074 进一步用 Node Happy/Repair、Python Test Failure/Repair、Minimal Git UNKNOWN/失败 Archive 及旧/新真实 Commit Service 接管形成统一产品矩阵；只有 Runtime Task、真实 Agent/Git/Test/Artifact/Receipt 和可复验快照算作通过。TASK-0075 将同一 clean sealed Commit 构建为 GA tarball、image、SBOM 与 Release Manifest，并用 append-only publish ledger 执行外部对账和发布后 clean-install。Framework MVP 的本地产品形态已经可交付，但任何 `BLOCKED_AUTH` 渠道仍不得声明已公开发布。

跨版本接管不会靠版本字符串推断：Service `/healthz` 暴露只读 `release.version + sourceRevision`，Harness 保存新版本 Git Commit/Tree/bundle，且同一 Workflow 的每次注册都记录实际 Commit。长 Role 已产生 Manifest 但未确认时，Harness 只用绑定同一 Run/Attempt/Digest 的 Evidence 完成 `CONFIRMED` 对账；不会重跑 Agent。已归档 Task 在升级前后必须保持相同 Projection Digest。
