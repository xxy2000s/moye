# Milestone 3：Backlog 可读性、Agent Session 证据语义与项目文档脚手架

> 文档类型：Delivery Plan  
> 状态：Completed
> 计划基线：2026-08-27  
> Revision：1  
> 需求来源：项目 Owner 关于 Backlog 现象表达、当前未完成条目补录和 BL-0083 纳入后续长时开发的直接要求；[BL-0083](../backlog/BL-0083.yaml)  
> 前置 Milestone：[M1 Agent Session Evidence](./m1-agent-session-evidence.md)、[M2 Framework Release](./m2-framework-release.md)  
> 执行边界：项目 Owner 于 2026-08-27 批准 Revision 1；按 W01～W07 连续执行，Runtime 只通过正式 Workflow/CLI 推进。

## 1. Milestone Outcome

让 Backlog 和 Agent Session 页面都能直接回答“实际发生了什么、当前缺什么、为什么这样判断、下一步是什么”，并让外部项目可以非破坏性地建立标准文档治理起点，同时保持 Git 文档、Runtime Projection 和既有 Evidence 的权威边界：

```text
Backlog YAML
  → versioned problem contract
  → idempotent ProjectBoard sync
  → compact card + on-demand detail

Session Evidence
  → availability
  → content completeness
  → Prompt / Attempt binding confidence
  → policy / provider limitations
  → accurate Board wording + diagnostics

External Project
  → standard documentation scaffold
  → project-local operating contract and indexes
  → Documentation Agent / deterministic Gate
```

完成后：

- 新 Backlog 不再只有标题和验收方向，而是至少包含问题陈述、已观察现象、期望行为、影响和证据引用；
- 当前仍有效且页面需要展示的 Backlog 获得上述信息，历史已完成条目不做批量迁移；
- Backlog 卡片保持紧凑，详情通过弹窗或等价的按需层展示，不把整段文字铺满看板；
- Git 中尚未同步的 BL-0083 通过正式同步进入 Board；
- 历史 Session “正文可读但 Prompt 强绑定无法追溯验证”不再统一显示成“记录不完整”；
- 原始 Manifest、Receipt、Projection、Event 和 Digest 不被回写或美化。
- 外部项目可以通过消费级 CLI 生成最小标准文档结构，并直接接入 Moye 的 Documentation Policy；已有文件不会被静默覆盖。

## 2. 当前事实基线

### 2.1 Backlog 合同与页面

- `docs/meta/templates/backlog-item.yaml` 和 `src/backlog/document-sync.ts` 当前只接受 `schema_version: 1`；没有结构化的现象、期望、影响或 Evidence 字段。
- Parser 会校验 `affected_areas` 与 `acceptance_outline`，但 `BacklogProjection` 没有保存它们；Board API 因此只能返回标题、类型、状态、优先级、来源和 Task 引用。
- `public/app.js` 当前卡片只展示 ID、标题、优先级、状态和类型，没有 Backlog 详情入口。
- 2026-08-27 对 `http://127.0.0.1:3000/api/board` 的只读核对显示 5 个条目：BL-0004、BL-0005、BL-0006、BL-0007、BL-0031。
- BL-0031 的 Git 文档已经是 `converted_to_task` 且绑定 TASK-0029，但 Runtime 仍保留旧的 `CAPTURED` Projection。这是同步滞后，不应通过直接编辑 Projection 或补造“未完成现象”掩盖。

### 2.2 最近未同步的 BL-0083

- BL-0083 已存在于 Git、Backlog 索引和 Document Graph，Git 基线提交为 `19aed2fc62e0ba8deab9dd4bb32424d523843df8`。
- 当前 Runtime Board 尚无 BL-0083；它必须在合同兼容和部署完成后通过正式 `backlog sync` 进入 ProjectBoard。
- BL-0083 记录的真实问题是：页面把 Session 内容完整性和 Prompt/Attempt 绑定可信度混成单一 `PARTIAL` 提示。
- 对历史 Enrichment，消息、时间、层级和 Parser 指标可能没有缺口，但旧任务没有 pre-execution Prompt Envelope，因此只能声明绑定 `UNVERIFIED`，不能把可读正文误报为缺失，也不能把它升级成 `VERIFIED`。

### 2.3 外部项目文档初始化

- 当前 `moye init` 生成 `.moye/project.yaml`，默认 `documentation.policy: conventional`，但不会生成 AGENTS、Sources、Delivery、Knowledge、Meta、模板或文档索引。
- `moye-doc-graph` 当前只验证项目已经存在的图谱与校验入口，不负责安装文档体系。
- Documentation Agent 和确定性 Gate 可以审计 Candidate 文档变化，但框架目前没有为一个空白外部项目提供可直接消费的标准文档起点。
- 本缺口独立于 Runtime 启动：Restate、Moye Service 与 Board 继续由既有 `runtime:up` 管理；Phoenix/OTLP 自动启动不进入 M3。

这些事实只定义 M3 的输入，不代表对应能力已经实现。

## 3. Requirements

| Requirement | 要求 |
|---|---|
| `M3-REQ-01` | 定义向后兼容的 Backlog 问题描述合同；新条目必须表达 `observed / expected / impact`，可引用真实 Evidence，旧 v1 文档继续可读。 |
| `M3-REQ-02` | Backlog Projection 和同步链保存页面真正需要的 `problem`、`affectedAreas`、`acceptanceOutline`，并维持批次幂等、文档所有权和 Digest 校验。 |
| `M3-REQ-03` | 只补录当前有效开放条目 BL-0004、BL-0005、BL-0006、BL-0007 与 BL-0083；不批量迁移已完成历史。 |
| `M3-REQ-04` | 使用正式文档同步让 BL-0083 出现在 Board，并让 BL-0031 按 Git 中既有 `converted_to_task` 事实收敛；不得直接改 Runtime Projection。 |
| `M3-REQ-05` | 看板卡片继续紧凑；点击后显示现象、期望、影响、证据、验收方向、来源和关联 Task，并具备键盘、窄屏和错误降级行为。 |
| `M3-REQ-06` | Session 展示分别建模 availability、content completeness、binding confidence、policy/provider limitation；一个维度不能冒充另一个维度。 |
| `M3-REQ-07` | 旧 Evidence 只做确定性兼容映射；不得回写或替换既有 Manifest、Receipt、Projection、Event、Artifact 和 Digest。 |
| `M3-REQ-08` | BL-0083 的历史 Enrichment 场景显示“会话内容可读；Prompt 强绑定无法追溯验证”，真正解析/丢弃/未知/截断缺口仍逐项显示 `PARTIAL` 原因。 |
| `M3-REQ-09` | `PENDING / WAITING_RECONCILE / UNAVAILABLE / FAILED / integrity error` 保持独立状态和操作建议；`OMITTED_BY_POLICY / NOT_EXPOSED` 不得误报为数据丢失。 |
| `M3-REQ-10` | 消费级 CLI 提供显式的标准文档脚手架入口，为空白外部项目生成最小可导航、可验证、可被 Documentation Agent 消费的文档结构。 |
| `M3-REQ-11` | 脚手架必须非破坏性：先计划后写入，已有文件或语义冲突时 fail closed；不能静默覆盖 AGENTS、README、项目文档或配置。 |
| `M3-REQ-12` | 生成结果与 `.moye/project.yaml` Documentation Policy 一致，并通过真实外部项目的初始化、文档 Gate、Repair 和重复执行验收。 |
| `M3-REQ-13` | 自动化、真实 Runtime 同步、真实历史 Session API、文档脚手架外部项目和桌面/窄屏浏览器证据全部通过后，才部署到 `http://127.0.0.1:3000` 供验收。 |

## 4. 工作包与拟议 Task 映射

批准 Revision 1 后才冻结以下 Task ID。每个 Task 对应唯一 Result Commit；前一工作包未通过 Seal/Archive Gate，不启动其依赖项。

| Work Package / Proposed Task | 档位 | 依赖 | 交付范围 | 核心验收 |
|---|---|---|---|---|
| `M3-W01 / TASK-0077` Backlog Problem Contract v2 | Full | 无 | 定义 v2 `problem` 合同；扩展 Domain Projection、严格 Parser、模板和同步；保留 v1 只读兼容 | v2 缺必需字段 fail closed；v1 不迁移也可同步；相同文档重复同步幂等；未知字段、错误 Digest 和所有权冲突拒绝 |
| `M3-W02 / TASK-0078` Active Backlog Enrichment and Canonical Sync | Standard | W01 | 为 BL-0004/0005/0006/0007/0083 补录事实；部署兼容 Service 后执行一次正式文档同步；对账 BL-0031 | Board 开放列表包含 BL-0004/5/6/7/83；BL-0031 不再以旧 `CAPTURED` 长期展示；第二次相同同步 `unchanged`；无直接 Projection 写入 |
| `M3-W03 / TASK-0079` Backlog Detail UX | Standard | W01 | 紧凑卡片、按需详情弹窗、信息层级、加载/错误/空值、键盘和响应式布局 | 1440px 与 390px 真实浏览器通过；卡片高度不被长文撑开；详情能读完 problem、Evidence、acceptance、source/task refs；Escape 与焦点返回正确 |
| `M3-W04 / TASK-0080` Session Completeness Semantic Contract | Full | TASK-0076 | 冻结四维 Session 状态与旧 Evidence 兼容表；必要时版本化新 Evidence 语义，不改写旧记录 | 相同原始 Evidence 得到唯一分类；`content complete + binding unverified` 可表达；policy/provider omission 与丢失区分；不允许 UI 自行猜测 |
| `M3-W05 / TASK-0081` Session Presentation and Diagnostics | Standard | W04 | Board resolver/API 和 Session Dialog 消费统一语义；主提示、状态徽标、原因和高级诊断分层 | BL-0083 各场景逐条通过；历史 Enrichment 不再显示通用“不完整”；真实缺口仍显示具体原因；原始 `PARTIAL/UNVERIFIED` 可在高级诊断查询 |
| `M3-W06 / TASK-0082` Standard Documentation Scaffold | Full | M2 | 为消费级 CLI 增加显式标准文档初始化；生成最小操作契约、Sources/Delivery/Knowledge/Meta 入口、模板和可执行验证入口；与 Manifest policy 绑定 | 空白项目一条命令生成并通过验证；已有项目冲突不覆盖；重复执行幂等；真实 Standard Task 能更新文档并通过 Documentation Gate |
| `M3-W07 / TASK-0083` Product Acceptance, Docs and Deployment | Full | W02、W03、W05、W06 | 聚合自动化、真实 Restate/Board、历史 Session、脚手架外部项目与浏览器矩阵；更新 README/Architecture/CodeMap/Runbook/Milestone；部署最终服务 | 全部门禁通过；M3 Task 全部唯一归档；Board 与 Git/Runtime 一致；最终报告列出 Commit、Projection Digest、Sync Receipt、Session Evidence、Scaffold Manifest 和页面链接 |

档位说明：W01 涉及持久化 Schema，W04 涉及 Evidence/Artifact 语义，W06 涉及公共 CLI、外部项目文件写入和治理合同，W07 涉及最终部署，因此使用 Full；W02、W03、W05 是边界明确的产品工作，使用 Standard，不强制为了形式执行完整五角色链。`performance` 只在没有共享文件和 Runtime 写冲突时并行 W03、W04 与 W06。

## 5. 固定执行顺序

```text
Owner approves M3 Revision 1
  → W01 Backlog Contract
      ├──→ W02 Active Data + Canonical Sync
      └──→ W03 Backlog Detail UX

TASK-0076 completed
  → W04 Session Semantic Contract
      → W05 Session Presentation

M2 completed
  → W06 Standard Documentation Scaffold

W02 + W03 + W05 + W06
  → W07 Product Acceptance + Docs + Deployment
```

W03、W04 与 W06 可以在隔离 Worktree 中并行；W02 必须等待 W01 的兼容 Service 已部署，避免 v2 文档被旧 Runtime 拒绝或字段被丢弃。最终 Backlog Sync 只由 W02 的 owning Task 执行一次并保存回执。

## 6. Backlog v2 拟议合同

W01 需要在 Spec/Design 中冻结最终 Schema；Revision 1 的建议最小形态是：

```yaml
schema_version: 2
id: BL-NNNN
title: "一句话标题"
kind: bug
status: triaged
priority: medium

problem:
  observed: "已实际观察到什么"
  expected: "期望怎样"
  impact: "影响谁或什么流程"
  evidence_refs:
    - "稳定文档 ID、Task ID、API 路径或内容摘要"
```

约束：

1. `observed / expected / impact` 对新 v2 文档为非空字段；标题承担一句话问题概括。没有真实证据时 `evidence_refs` 可为空，但不能编造引用。
2. `acceptance_outline` 是可选的一两条结果级方向，不复制 Task Spec，也不写页面流程、API、Schema、实施步骤或测试矩阵。
3. v1 文档继续合法；M3 不要求 82 个历史条目整体升级。
4. v2 字段必须进入受 Document Digest 保护的 Projection，Board 不重新读取仓库文件补字段。
5. Runtime 创建的 Backlog 若继续被支持，也必须显式满足同等领域合同，不能绕过验证。

## 7. 当前条目处置清单

| Backlog | M3 处置 | 原因 |
|---|---|---|
| BL-0004 | 升级 v2 并补录问题事实 | 当前仍是有效生产能力缺口，Board 正在展示 |
| BL-0005 | 升级 v2 并补录问题事实 | 当前仍是有效远程 SCM/PR 缺口，Board 正在展示 |
| BL-0006 | 升级 v2 并说明“Core 子集已消费、生产观测仍缺” | 避免把部分完成误读为完全未做或完全完成 |
| BL-0007 | 升级 v2 并说明“候选/处置已消费、自动提升与反馈仍缺” | 避免把部分完成误读为完全未做或完全完成 |
| BL-0031 | 不迁移内容；通过正式同步消费 Git 中既有 converted 状态 | 它不是当前开放需求，页面展示来自过期 Projection |
| BL-0083 | 升级 v2、补齐现象与 Evidence，并正式同步 | 最近登记但尚未进入 Runtime Board 的真实 Bug |
| 其他 completed/converted 历史 | 不迁移 | 用户明确要求忽略历史数据；保持旧文档和历史 Digest |

## 8. Session 四维语义

W04 必须把以下维度分别计算、传输和展示：

| 维度 | 示例 | 回答的问题 |
|---|---|---|
| Availability | `PENDING / AVAILABLE / WAITING_RECONCILE / UNAVAILABLE / FAILED` | Evidence 现在能否读取？ |
| Content Completeness | `COMPLETE / PARTIAL` + reasons | 已读取的消息、时间、层级、工具和解析结果是否缺失？ |
| Binding Confidence | `VERIFIED / UNVERIFIED / NOT_APPLICABLE` | 这份 Transcript 是否被 pre-execution Prompt Envelope 与 Attempt 强绑定？ |
| Limitation | `OMITTED_BY_POLICY / NOT_EXPOSED / REDACTED / NONE` | 缺少内容是策略或 Provider 边界，还是实际数据损坏？ |

示例判定：

```text
Historical enrichment
+ messages/timestamps/hierarchy/parser metrics complete
+ old task had no pre-execution Prompt Envelope
= AVAILABLE + COMPLETE + BINDING_UNVERIFIED

这应显示：
“会话内容可读；由于该历史任务创建时尚未冻结 Prompt Envelope，Prompt 与 Attempt 的强绑定无法追溯验证。”

而不是：
“该记录不完整，缺失项不会被页面补造。”
```

## 9. 标准文档脚手架边界

W06 需要在 Spec/Design 中冻结最终命令名和模板版本；Revision 1 只固定以下产品行为：

1. 使用者通过显式 CLI 选项启用标准文档脚手架；普通 `moye init` 不应在没有选择时向现有仓库批量写文档。
2. 最小结构包含项目级 Agent 操作契约、文档总入口、Sources、Delivery、Knowledge、Meta、Backlog/Task 模板和可由框架执行的验证入口；模板内容面向消费项目，不复制 Moye 内部历史。
3. 写入前输出确定性计划和冲突列表；已有同名文件、不可识别结构或路径越界时拒绝，除非后续 Spec 定义了可审计、可恢复的显式 adoption 流程。
4. 生成的 Manifest 必须选择与脚手架匹配的 Documentation Policy；Documentation Agent 负责审计当前项目事实，确定性 Gate 负责执行验证，二者都不能仅凭 Agent 自报通过。
5. 第二次对相同生成结果执行必须幂等；模板版本变化走显式 upgrade/migration，不静默重写用户内容。
6. 至少使用一个仓库外的空白 Git 项目和一个已有 README/docs 的项目做真实产品验收。

## 10. 验收矩阵

至少建立以下 `Requirement → Scenario → Execution → Evidence` 映射：

| 场景 | 执行 | 必须保存的 Evidence |
|---|---|---|
| Backlog v1 兼容 | 现有 v1 fixture 和真实文档 load/sync | batchId、source digest、Projection 摘要、unchanged result |
| Backlog v2 正常/非法 | v2 parser、unknown/missing field、ownership conflict | Test case、错误码、Projection Digest |
| 当前开放条目同步 | 真实 Restate ProjectBoard sync 两次 | BL ID、输入 Digest、Sync Receipt、前后 Board 摘要、第二次幂等结果 |
| BL-0031 状态收敛 | 同一正式 sync batch | Git source Digest、Runtime 旧/新状态；无直接 Projection mutation 证明 |
| Backlog 详情 UX | 真实 Board 1440px/390px | 截图、键盘路径、焦点/Escape、网络错误恢复 |
| Historical complete + unverified | 真实历史 enrichment Session | Task/Role/Attempt/Session、Manifest/Receipt Digest、API 四维状态、页面截图 |
| 真正 partial | 有解析/未知/截断缺口的受管 Evidence | 缺失原因列表、API/UI 一致性、原始诊断引用 |
| policy/provider limitation | omitted/not exposed Evidence | 不被计入 data-loss 的断言和页面文案 |
| pending/reconcile/unavailable/failed | 各状态 fixture + 可取得的真实 Runtime Evidence | 状态、操作建议、无错误合并证明 |
| 空白项目文档初始化 | 从已发布 tarball 安装 CLI，在仓库外执行 scaffold | Scaffold Manifest、生成路径/Digest、project/docs validate、clean Git diff |
| 已有项目冲突与重复执行 | 带 README/AGENTS/docs 的真实 Git fixture | 无覆盖证明、稳定冲突报告、相同输入幂等、路径边界拒绝 |
| 脚手架后的 Standard Task | 真实 Agent 修改产品事实并触发 Documentation Policy | Role Session、Candidate、Docs Evidence、Repair（适用时）、Final Gate 与 Archive |
| 最终回归 | 仓库与产品门禁 | `npm run check`、`npm run test:e2e`、M3 acceptance summary |

W07 应提供一个无需手工点击、不会扫描目录挑选历史结果的统一入口，建议命名：

```bash
npm run acceptance:m3
```

真实 Session 产品验收必须显式绑定 Task/Role/Run/Session 和受管 Manifest；Fake/Mock 只用于 Parser 与 UI 边界，不得冒充真实历史 Session 通过证据。

## 11. 非目标与剩余边界

M3 不包含：

- 批量改写全部历史 Backlog 到 v2；
- 修改历史 Session Artifact、Receipt、Manifest、Projection、Domain Event 或 Digest；
- 从 Provider Home 或本机目录扫描推断 Board 数据；
- 把 `UNVERIFIED` 重新包装成 `VERIFIED`；
- 多租户 Auth/RBAC、加密保留策略、远端 Artifact Store；
- 多 Daemon Lease/Fencing、远程 Git Provider/PR 等 BL-0004/BL-0005 的功能实现本身；
- 为简单 UI 或数据补录强制启动完整五角色研发链；
- 自动拉起 Phoenix/OTLP 等可选可观测后端，或改变既有 Restate/Moye Runtime 启动边界；
- 强制所有外部项目采用 Moye 文档结构，或覆盖/迁移用户已有文档；
- 公开 Registry 发版。若 M3 只修改 `0.1.x` 兼容行为，版本策略由 W07 根据实际公共契约影响决定。

## 12. 长时运行规则

批准后：

1. 按 W01～W07 分别创建真实 Task；每个 Task 有自己的 Spec、Design、Plan、Verification、Docs Impact、唯一 Result Commit、Seal 和 Archive Receipt。
2. 普通技术决策自动完成；只有外部权限缺失、不可恢复破坏风险或审批范围冲突时阻塞。
3. 不直接编辑 Runtime Projection，不删除或覆盖旧 Backlog/Session 历史，不通过页面本地拼装制造新事实。
4. W02 的同步必须使用正式 CLI/Runtime API，保存 batchId、输入 Digest 与 Sync Result；结果未知时先查询，不重复制造不同批次。
5. 任何工作包发现范围外缺陷时记录 Finding/Backlog；除非阻塞 M3 验收，不静默扩大当前 Task。
6. 每个 Task 完成后清理其 Worktree 和临时进程；只保留主 Moye Worktree、正式 Runtime 和验收要求的受管 Artifact。
7. 最终服务运行在 `http://127.0.0.1:3000`；最终报告逐项列出 Task ID、Result Commit、Runtime Outcome、Sync Receipt、Evidence Digest 和页面链接。

## 13. Milestone 完成定义

只有同时满足以下条件，M3 才能宣布完成：

1. W01～W07 全部形成唯一 Result Commit 和 `CLOSED + ARCHIVED` 终态；
2. 新 v2 Backlog 能完整表达 problem，旧 v1 Backlog 不迁移也能继续读取和同步；
3. BL-0004/0005/0006/0007/0083 的详情在 Board 可查询，且 BL-0031 不再以过期开放状态展示；
4. BL-0083 已通过正式 sync 进入 Runtime Board，相同 sync 重放幂等；
5. Backlog 卡片紧凑、详情可读、桌面/窄屏和键盘验收通过；
6. Session 四维语义由统一领域逻辑生成，API 与页面不分别猜测；
7. 历史可读 Session 不再被误报为内容不完整，真实缺失和策略限制仍准确展示；
8. 旧 Evidence、Projection 和 Digest 前后不变；
9. 外部空白项目能通过消费级 CLI 非破坏性生成标准文档结构，已有项目冲突不覆盖，重复执行幂等；
10. 脚手架项目的真实 Standard Task 能形成文档变更 Evidence 并通过 Documentation Gate；
11. `npm run check`、`npm run test:e2e`、`npm run acceptance:m3` 和文档门禁通过；
12. 最终服务部署在 `http://127.0.0.1:3000`，报告明确列出仍未实现的生产能力。

## 14. 审批记录

- 当前结论：项目 Owner 于 2026-08-27 批准 Revision 1；TASK-0077～TASK-0083 对应 W01～W07。
- 执行方式：无普通技术决策中断的连续长时运行，直至完成条件满足或出现明确外部阻塞。
- 运行记录：TASK-0077 已在 canonical Runtime 启动；首次误投旧 Runtime 的真实事件与非破坏清理见 [Incident](../../sources/incidents/2026-08-27-task-0077-seal-submitted-to-stale-runtime.md)。

## 15. 完成记录

2026-08-27，W01～W06 已分别形成唯一 Result Commit，并由 canonical Runtime 收敛到 `CLOSED + ARCHIVED + SUCCEEDED`；W07 的同一 Result Commit 包含最终聚合器、修复后的严格 v2 Demo 回归、仓库门禁、浏览器证据与本完成记录，随后按 sealed-result-commit 协议部署和关闭。

| Work Package | Result Commit | Runtime / 核心证据 |
|---|---|---|
| W01 / TASK-0077 | `1f6760808dcf78a418fbbff8bbca73c3d22c9a6a` | Backlog v2 合同、v1 兼容与严格投影；Package `sha256:b8eb6079…12a90db` |
| W02 / TASK-0078 | `6c8cbb74b9260bc0ff8a2cdb4101deb2aaee9060` | Sync batch `98457bb9…9b955`，五个开放条目，BL-0031 收敛，重放 unchanged |
| W03 / TASK-0079 | `2567fc9093b13eee225001d903a90564d8c62d3f` | 1440/390、键盘、错误恢复与只读边界浏览器证据 `sha256:f2b24128…d31755` |
| W04 / TASK-0080 | `f262522c1bc05f81c9339c4e5fa151f511521b1f` | Session 四维语义 Evidence `sha256:ab0aa402…76a68e`，旧 Manifest/Receipt/Digest 不变 |
| W05 / TASK-0081 | `d369e9d3d9621391999e2db48a959a2e7fa29d7b` | 固定历史 Session 显示 `AVAILABLE + COMPLETE + UNVERIFIED + NONE`，高级诊断保留原始事实 |
| W06 / TASK-0082 | `241a81938065f9e4efec32507e4af2aa43380779` | packed scaffold、冲突/路径边界、真实 custom-policy Task；Bundle `sha256:c5944bed…1bace` |
| W07 / TASK-0083 | 本文所在唯一 Result Commit | `npm run acceptance:m3` 固定输入报告、当前源码真实浏览器、check/e2e、Document Graph、最终 Deployment 与 Runtime Seal |

本里程碑没有公开发布新 Registry 版本，也没有实现生产 Auth/RBAC、远端 Artifact/Git Provider、多 Daemon Lease/Fencing 或自动 Phoenix/OTLP；这些限制不因本地 tarball、Runtime Deployment 或 M3 完成而改变。
