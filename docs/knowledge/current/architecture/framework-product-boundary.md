# Framework MVP 公共产品边界

> 文档类型：Architecture
> 状态：Current / M2 implementation in progress
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

Release Manifest 把 Git Commit、npm tarball Digest、容器 Digest、Schema versions 和 channel 绑定为唯一 Release Identity。任何目标端回执未知都先 Reconcile；相同版本不同 Digest 是硬冲突。

## 5. 当前实现状态

Project Manifest v1 已由 `src/framework/project-manifest.ts` 实现，并以 `schemas/project.schema.json` 分发机器可读 Schema。`init` 采用安全默认值且不覆盖，`project validate` 输出 canonical Digest；legacy v0 只有明确窄化结构可以迁移，未知/未来版本稳定拒绝。路径执行词法与真实路径边界检查，命令只接受 argv 并拒绝 shell、破坏性 executable 与 inline eval。

消费级 `MoyeClient` 与 CLI 已实现：公共 start request 只有 Manifest 路径、需求、验收标准和可选 Task ID；内部自动冻结 clean HEAD、存在且等于 base 的 target ref、测试 argv、Runner 和仓库外 Artifact namespace，再单次提交 keyed `CoreV2Workflow`。status/watch 每次经 TaskAuthority 附着 owning Workflow，open 只生成稳定 Board URL。doctor 只读检查 Manifest、Git、target、Agent、test executable、Artifact 权限、Docker、Restate 和 Board。

默认 Transcript policy 已收紧为 `none`；只有项目同时显式选择 `digest_only | full` 并允许 Prompt capture 时 Client 才构造 Session Evidence。`redacted` 仍未实现，不能静默降级。

Plugin SDK v1 已由 `src/framework/plugin-sdk.ts` 实现：七类 Adapter 共享版本化 Descriptor、Operation Context、内容寻址 `COMPLETE | UNKNOWN | FAILED` Result 和 capability negotiation。公共 Context 不包含 Projection、Reducer、Authority、Workflow dispatch 或 Runtime journal；相关 capability 前缀会被 fail closed 拒绝。`RECONCILABLE` Adapter 必须同时声明 `effect.reconcile` 和 handler，UNKNOWN token 绑定 operation/idempotency key/intent，重复 execute/reconcile 必须返回相同字节。

`src/framework/builtin-adapters.ts` 把现有 Agent Runner、Workspace/Git、Trusted Test、Docs Graph、Local SCM、Filesystem Artifact 和 Observer/Knowledge 实现登记为七个 bridge；统一契约入口会加载并验证真实 export，而不是给 Plugin 状态推进权限。当前只冻结 SDK 和内建 bridge，动态第三方代码加载、Sandbox/Secrets、市场和 owning Workflow 的可配置 dispatch 不在 W04 范围。

Documentation Policy v1 已实现 `none | conventional | moye-doc-graph | custom`。Client 把 Manifest policy 冻结到私有 Workflow Input；Core v2 在独立 Documentation Agent PASS 后执行确定性 Gate：先验证 clean worktree 与 HEAD=Candidate，再读取 `base..candidate` Git diff。`none` 记录 `NOT_REQUIRED`；`conventional` 在产品代码变化而没有项目事实文档变化时阻塞；Graph/custom 使用无 shell、受限输出和固定超时的 argv Runner。Evidence 绑定 Task/Revision/Generation/Base/Candidate/changed-files/command Digest，幂等写入 Artifact namespace，再成为 Final Review 依赖的 Docs Impact Payload。旧 Workflow Input 没有 policy 字段时保留 legacy command sequence，不在重放中插入新 durable step。

分发、包流水线、示例和外部产品矩阵仍由 TASK-0071～TASK-0075 顺序实现。在这些证据完成前，Moye 仍不能声明 Framework MVP 已公开发布。
