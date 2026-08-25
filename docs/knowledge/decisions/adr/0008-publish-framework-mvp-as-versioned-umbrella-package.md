# ADR-0008：以版本化单包与私有 Runtime 发布 Framework MVP

> 状态：Accepted
> 日期：2026-08-25
> 决策者：Moye Core
> 关联文档：[Framework MVP 公共边界](../../current/architecture/framework-product-boundary.md)、[Milestone 2](../../../delivery/milestones/m2-framework-release.md)

## Context

Core v2 已证明受控本地环境中的真实多 Agent、Git、测试、Closure 与 Archive 闭环，但外部项目仍需理解内部 Workflow Input、本机 Artifact Root 和 Restate handler。Framework MVP 必须提供可安装边界，同时保护 Workflow 状态主权、历史 Evidence 字节和未知副作用对账语义。

首版若立即拆成多个独立 npm 包，会引入包间版本矩阵、原子发布和 npm scope 所有权要求；这些复杂度并不提高首个外部项目闭环的可信度。

## Decision

### 发布形态

Framework MVP 使用一个可安装的 npm umbrella package `moye`，首个公开产品版本冻结为 `0.1.0`。它提供稳定子路径：

- `moye/core`：Project、Task、Event、Artifact 和错误的公共 Schema/类型；
- `moye/client`：消费级 HTTP Client，只提交意图并读取事实；
- `moye/plugin-sdk`：Adapter 契约、capability negotiation 和 contract suite；
- `moye` 命令：`init`、`doctor`、`project validate`、`task start/status/watch/open`。

`src/restate/**`、内部 Projection/reducer 写入口、原始 Workflow Input、recovery successor、运行时 token 和本机 Artifact 路径不属于公共 API。Service/Restate Runtime 通过同版本容器分发，不作为可被外部代码直接 import 的公共子路径。未来可以把子路径拆成 `@moye/*` 包；拆分前保持入口语义和 Schema 兼容。

### 版本与兼容

- 产品版本遵循 SemVer；Git Tag 使用 `v<version>`，npm 包、容器标签和 Release Manifest 必须相同。
- `.moye/project.yaml` 使用独立整数 `schemaVersion`；首版为 `1`。
- Client 协议使用 `apiVersion: 1`；Plugin 契约使用 `pluginApiVersion: 1`。
- 同一 major 内至少兼容当前与前一个 Manifest schema；能无损迁移时提供显式迁移，不能迁移时返回稳定错误码和人工动作，不静默猜测。
- 公共 Schema 的 additive optional 字段属于 minor；移除、改义或收紧有效输入属于 major。Plugin capability 增加可以是 minor，但已有 capability 语义不能在同一 major 中改变。
- 已归档 Artifact/Manifest 按其原 schema 读取，禁止就地重写。运行中 Workflow 绑定启动时的 runtime/schema revision；升级后必须继续由兼容 handler 重放，或进入明确的 migration/reconcile wait，不能新建 Task 或重跑昂贵步骤冒充迁移。

### 发布身份与副作用

唯一 Release Identity 是 canonical manifest：`version + gitCommit + packageDigest + imageDigest + schemaVersions + channel` 的摘要。RC 使用 `v0.1.0-rc.N`/npm prerelease/不可变镜像标签，GA 使用 `v0.1.0`。

Git Tag、GitHub Release、npm publish 和容器 push 都是外部 Effect：发布前持久化 Intent；成功后保存 Registry/remote Receipt；回执未知时先按版本和 Digest 查询目标端。相同字节重复确认幂等，不同字节占用同一版本必须拒绝，禁止覆盖 Tag 或复用版本。

### 安全与隐私

默认只监听 loopback。Manifest 只允许仓库内相对路径和 argv 数组；不接受隐式 shell。Prompt、源码、Token、Provider Home 和 Session 默认不上传，Transcript capture 必须由项目策略显式开启。Plugin 只能返回 Evidence/Effect Result，不能推进 Task 主状态。

## Consequences

- 外部项目只安装一个版本即可使用 CLI、Client 和 Plugin SDK，首发和回滚具备原子版本身份；
- 后续实现必须提供真实 JSON Schema、迁移、capability 和 package export contract tests；
- Runtime 容器与 npm 包共享版本但生命周期分离，CLI 不携带第二套状态机；
- 首版不是多租户生产平台，也不承诺远程 PR、跨节点调度、Auth/RBAC、生产 Sandbox、HA 或远端 Artifact Store；
- npm 包名或 Registry 权限不可用时，允许以经过验证的本地 tarball/RC 停止，但不得声称公开发布成功。

## Rejected

- 首版直接发布五个相互依赖的 `@moye/*` 包：增加原子发布与 scope 权限风险，价值可由稳定子路径先验证。
- 把 Restate Workflow Input 作为公共 Client API：泄露内部状态机和路径，阻碍兼容演进。
- 只用 package version 代表 Schema/Plugin 版本：无法对单项协议能力进行协商和明确拒绝。
- 发布回执未知时再次 push/publish：可能覆盖或制造冲突产物。
