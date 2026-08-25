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

默认 Transcript policy 已收紧为 `none`；只有项目同时显式选择 `digest_only | full` 并允许 Prompt capture 时 Client 才构造 Session Evidence。`redacted` 等待 W04 capability/plugin 支持，不能静默降级。

Plugin、Documentation Policy、分发、包流水线、示例和外部产品矩阵仍由 TASK-0069～TASK-0075 顺序实现。在这些证据完成前，Moye 仍不能声明 Framework MVP 已公开发布。
