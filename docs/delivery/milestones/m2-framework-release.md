# Milestone 2：Moye Framework MVP 产品化与首个正式发版

> 文档类型：Delivery Plan
> 状态：In Progress / W05 completed
> 计划基线：2026-08-25
> 冻结 Revision：1
> 需求来源：[Moye 外部项目框架化需求基线](../../sources/brainstorm/external-project-framework-productization.md)、[BL-0068](../backlog/BL-0068.yaml)
> 前置 Milestone：[Milestone 1：完整 Agent Session 与 Prompt 证据链](./m1-agent-session-evidence.md)
> 执行边界：项目 Owner 已批准范围和有凭证时的发版动作；M1 已由 `moye-m1-agent-session-evidence-r1` 冻结，M2 正式开始。

## 1. Milestone Outcome

把已经在受控本地环境跑通的 Core v2 Kernel，交付为其他 Git 项目无需修改 Moye 源码即可安装、配置、启动、跟踪和升级的 Framework MVP：

```text
External Repository
  └── .moye/project.yaml
          ↓
      Moye CLI / Client
          ↓
      Moye Service + Restate
          ├── Agent Runner Adapter
          ├── Workspace / Git Adapter
          ├── Trusted Test Adapter
          ├── Documentation Policy
          ├── SCM Adapter
          ├── Artifact Store
          └── Knowledge Sink
```

目标发布形态：

- 可安装的消费级 CLI；
- 版本化公共 Schema、Client 和 Plugin SDK；
- 可重复部署的 Moye Service 容器与 Restate Compose；
- Node/TypeScript、Python 和最小通用 Git 示例；
- 真实外部项目闭环与升级兼容证据；
- Release Candidate 演练后形成首个正式 Framework MVP Release。

本文不把本地 Framework MVP 外推为多租户生产平台。

## 2. 发版前当前缺口

当前仓库已经具备 Core v2、真实 Agent、Trusted Runner、本地 Git Merge、Closure、Archive、Board 和真实故障矩阵，但仍不满足消费级发版：

- 根 `package.json` 仍为 `private: true`，没有稳定公共包边界和发布产物；
- 外部项目必须理解内部 Workflow Input、`baseCommit`、`artifactRoot` 等字段；
- 没有版本化 `.moye/project.yaml`、Schema、迁移和兼容策略；
- `init`、`doctor`、`project validate`、消费级 `task start/status/watch/open` 尚未形成稳定产品入口；
- Agent、Workspace、Test、Documentation、SCM、Artifact 与 Knowledge 尚未成为公共 Adapter 契约；
- Documentation Gate 仍过度依赖 Moye 自身 Document Graph；
- 没有面向使用者的 Service 镜像、完整 Compose、健康检查、升级和回滚流程；
- 没有 Node/Python/通用 Git 外部项目的真实产品验收与 clean-install 验证；
- 没有经过兼容验证的版本、Release Notes、Git Tag、GitHub Release、npm/容器发布流程。

## 3. 工作包

每个工作包已冻结 Runtime Task ID；M1 完成后逐个创建 Active Task，每个 Task 对应唯一 Result Commit。

| Work Package | 依赖 | 交付范围 | 核心验收 |
|---|---|---|---|
| `M2-W01 / TASK-0066` Public Boundary, Versioning and Release ADR | M1 完成 | 冻结 Framework MVP 包边界、公共/内部 API、SemVer、Schema version、Workflow 升级、兼容窗口、RC/GA 渠道和发布目标 | ADR Accepted；公共契约不暴露 Restate 内部字段；明确哪些包公开、哪些实现私有；冻结首发版本策略 |
| `M2-W02 / TASK-0067` Project Manifest and Migration | W01 | 定义 `.moye/project.yaml`、JSON Schema、默认值、路径/权限约束、版本迁移；实现 `moye init`、`moye project validate` | 新仓库可生成并验证配置；旧 Schema 有显式迁移或拒绝原因；不允许越界仓库、危险命令或隐式 shell |
| `M2-W03 / TASK-0068` Consumer Client and CLI | W01、W02 | 实现稳定 Client；交付 `moye doctor`、`task start/status/watch/open`；自动解析 Git、Task ID、Artifact Root、Workflow Profile 和 Board URL | 使用者不构造 Workflow Input；一条命令启动真实任务；doctor 能诊断 Git、Agent、Docker/Service、权限、配置和测试命令 |
| `M2-W04 / TASK-0069` Plugin SDK and Adapter Contracts | W01 | 版本化 Agent Runner、Workspace/Git、Trusted Test、Documentation、SCM、Artifact Store、Knowledge Sink 接口；提供契约测试套件和 capability negotiation | 内建 Adapter 全部通过同一 contract suite；第三方 Adapter 不能推进 Task 主状态；UNKNOWN 副作用必须声明 Reconcile 能力 |
| `M2-W05 / TASK-0070` Pluggable Documentation Policy | W02、W04 | 支持 `none | conventional | moye-doc-graph | custom`；定义确定性 Docs Impact Evidence；移除外部项目对 Moye 自身 `docs/graph.yaml` 的强依赖 | 无 Moye 文档体系的 Node/Python 项目也能合法闭环；`none` 不等于 Agent 自报通过；custom policy 有受控 Runner 和 Digest |
| `M2-W06 / TASK-0071` Runtime Distribution and Operations | W01、W03 | Service Dockerfile、Service+Restate Compose、持久化卷、健康/就绪检查、配置模板、日志、备份、升级、回滚和卸载 Runbook | 空机器按文档可启动；重启保留 Runtime；升级前后已有任务可继续或明确迁移；默认仅本机安全暴露 |
| `M2-W07 / TASK-0072` Package and Release Pipeline | W01、W03、W04、W06 | 调整可发布包结构和构建输出；生成 tarball、checksum、license、SBOM/依赖清单；CI 执行测试、pack、容器构建、签名/来源信息和 RC dry-run | `npm pack` 后在隔离目录 clean install；容器可从零启动；版本、Tag、包和镜像一致；仓库无本机路径或私有 Runtime 数据 |
| `M2-W08 / TASK-0073` External Example Projects | W02～W06 | 提供 Node/TypeScript、Python、最小通用 Git 三个独立示例；每个示例只通过发布形态接入 | 示例不 import Moye 源码、不依赖 Moye `docs/graph.yaml`；安装、初始化、任务执行、页面下钻和清理都有说明 |
| `M2-W09 / TASK-0074` External Project Product Matrix | W05～W08 | 建立 Requirement → Project → Scenario → Execution → Evidence；真实执行 Happy、Repair、Reconcile、失败 Closure/Archive、Session Transcript 和升级兼容 | Fake/Mock 不作为产品证据；Node/Python 都成功归档；至少一个 Repair、一个 UNKNOWN/Reconcile、一个失败归档和一次版本升级通过 |
| `M2-W10 / TASK-0075` RC, GA Release and Handoff | W09 | 修复 RC Finding；冻结 README、Architecture、CodeMap、Runbook、安全/限制、迁移和 Release Notes；构建最终产物；执行被授权的 GitHub/npm/容器发布并回装验证 | `npm run check`、`npm run test:e2e`、M1/M2 acceptance 全通过；Tag/Release/包/镜像内容一致；最终服务在 `127.0.0.1:3000`；发布后 clean install smoke 通过 |

## 4. 固定执行顺序

```text
Milestone 1 Accepted + Completed
  → M2-W01
      ├── M2-W02 → M2-W03
      └── M2-W04
            ↓
          M2-W05
            ↓
          M2-W06
            ↓
          M2-W07
            ↓
          M2-W08
            ↓
          M2-W09
            ↓
          M2-W10
```

W02 与 W04 可在 W01 后并行；涉及公共契约的结果必须先由 W01 ADR 固定。一个工作包未通过验证和 Archive Gate，不启动依赖它的后续 Task。

## 5. 公共产品边界

W01 由 ADR-0008 冻结为单个 `moye@0.1.0` umbrella package，公共子路径边界为：

- `moye/core`：公共 Schema、Task/Event/Artifact 契约；
- `moye/client`：提交、查询、事件、对账和 Board 链接；
- `moye`：消费级 CLI；
- Moye Service 容器：私有 Restate Runtime 实现；
- `moye/plugin-sdk`：Adapter 接口、capability 和契约测试。

无论最终是否采用这些包名，都必须满足：

1. 公共包不导出内部 Projection 写入口；
2. CLI、Client 和 Plugin 不能形成第二套状态机；
3. Workflow 仍是 Task 主状态唯一所有者；
4. 公共 Schema 有版本、兼容测试和迁移策略；
5. Runner、SCM 和 Artifact 副作用都有幂等键或 Reconcile；
6. 默认安装不会读取或上传用户 Prompt、源码、Token 和本地 Session，除非项目策略明确允许。

## 6. 首次发版目标

计划的默认发布节奏：

```text
local package/container dry-run
  → release candidate
  → external project acceptance
  → GA release
  → clean install verification
```

候选发布目标：

- Git remote：`git@github.com:xxy2000s/moye.git`；
- Git Tag / GitHub Release：目标版本由 W01 冻结，默认候选为 `v0.1.0`；
- npm：发布通过 W01 确认的公开包；
- Container：发布 Moye Service 镜像及不可变版本标签；
- Release Notes：列出功能、安装、迁移、安全边界、已知限制和证据链接。

实际向 npm、GitHub Release 或容器 Registry 写入需要对应账号权限和凭证。批准本文表示批准发版目标与有凭证时的发布动作；缺少凭证时，W10 必须停在已验证的本地/RC 产物，不能伪造公开发布成功。

## 7. 外部项目验收矩阵

至少保存以下真实证据：

| Project | 场景 | 必须证明 |
|---|---|---|
| Node/TypeScript | Happy + Repair | init、doctor、真实多 Agent、测试、Merge、Closure、Archive、完整 Session 均通过 |
| Python | Happy + Test Failure/Repair | 自定义测试命令与文档策略生效，旧失败 Evidence 不通过最终 Gate |
| Minimal Git | UNKNOWN/Reconcile + Failure Archive | 不依赖语言工具链也能对账未知副作用，并获得唯一失败或成功归档终态 |
| Upgrade Fixture | 运行中和已归档任务跨版本 | 升级不重跑昂贵步骤、不破坏旧 Manifest，无法兼容时给出明确迁移/阻塞状态 |
| Clean Install | npm tarball + container | 不引用 Moye 源码工作区或本机缓存，按发布文档从零启动并完成 smoke task |

最终建议增加统一入口：

```bash
npm run acceptance:framework
npm run acceptance:framework:upgrade
npm run release:verify
```

## 8. 本 Milestone 不包含的生产平台能力

以下能力继续进入后续生产阶段，不阻塞 Framework MVP 发版，也不得被 Release Notes 宣称已完成：

- GitHub/GitLab 远程 Push、PR、审批和托管 Merge 的完整产品闭环；
- 多 Daemon 调度、Lease、跨节点接管和完整 Fencing；
- Auth、RBAC、多租户、项目隔离和资源配额；
- 生产 Sandbox、Secrets、网络和工具权限治理；
- S3/MinIO 等跨节点 Artifact Store；
- HA、SLO、告警、容量规划和灾备；
- 插件市场、远程模板市场和长期 Knowledge 效果反馈。

如果实施中某项被证明是 Framework MVP 的安全前置条件，必须建立 Finding/Backlog 并显式升级范围，不能静默塞入某个 Task。

## 9. 长时运行规则

- 批准后把 W01～W10 逐个转为真实 Task，每个 Task 有独立 Spec、Design、Plan、Verification、Docs Impact、Result Commit、Seal 和 Archive Receipt；
- M1 未完成前不开始对外发版工作；
- 普通技术决策自动处理，公共包名、版本和兼容策略由 W01 ADR 固定；
- 不向远程提交未通过 Gate 的 Commit，不改写已经发布的 Tag 或 Artifact；
- 发布副作用使用唯一 release identity、checksum 和对账；回执未知时先查 Registry/GitHub，不重复发布；
- 每个 Task 关闭后检查工作区、Worktree、进程、容器和临时 Registry，再自动进入下一个；
- 最终报告列出 Task、Commit、包版本、镜像 Digest、Git Tag、Release URL、外部项目 Task/Evidence 和仍未实现的生产能力。

## 10. Milestone 完成定义

只有同时满足以下条件，M2 才能宣布完成：

1. W01～W10 全部形成唯一 Result Commit 和归档终态；
2. 新项目无需修改 Moye 源码即可 `init → doctor → task start → watch/open → archive`；
3. Node、Python 和通用 Git 示例全部使用发布产物完成真实闭环；
4. Happy、Repair、Reconcile、失败 Archive、完整 Session 和升级兼容有真实 Evidence；
5. CLI、Client、Schema、Plugin、Service 与项目 Manifest 均有版本和兼容策略；
6. Service 容器、Compose、持久化、健康检查、升级与回滚可重复执行；
7. RC Finding 全部处置，最终包和镜像通过 clean-install 验证；
8. 有权限时完成 GitHub/npm/容器正式发布；无权限时明确报告为唯一外部阻塞，不宣称已公开发布；
9. README 和 Release Notes 准确区分 Framework MVP、本地受控能力和未实现的生产平台能力；
10. 最终服务启动在 `http://127.0.0.1:3000` 供逐项验收。

## 11. 审批记录

- 当前结论：项目 Owner 于 2026-08-25 批准 Revision 1、目标发布渠道与有凭证时的外部发布动作。
- 冻结映射：TASK-0066～TASK-0075 分别对应 W01～W10；M1 Tag 完成前不创建第一个 Active Task。
- 当前状态：M1 已冻结；TASK-0066～0071 已完成公共边界、Manifest、真实 Consumer Client/CLI、Plugin SDK、确定性 Documentation Policy 与可备份恢复的 Runtime Distribution；下一步 TASK-0072 Package and Release Pipeline。
