# Document Control Plane 详细设计

> 文档类型：Detailed Design  
> 状态：Implemented locally / Runtime integration pending  
> 版本：v0.3  
> 更新日期：2026-08-19  
> 关联设计：[Task Runtime Kernel](./task-runtime-kernel.md)

## 1. 问题

README、目录索引和 Agent 说明只能提高文档被发现的概率，不能保证：

- Agent 一定从正确入口开始；
- 任务修改某个模块时一定读取相关设计；
- Architecture 变化后相关 ADR、CodeMap 和 Pitfall 被检查；
- 新文档被加入导航；
- 文档依赖没有断裂；
- Task 结束时对所有关联文档做出更新或不更新的明确判断。

因此需要把文档从“静态目录”提升为 Task Runtime 的一个受控领域。

## 2. 核心结论

Document Control Plane 使用四个互补机制：

```text
Document Graph
  → Context Router
  → Docs Impact Report
  → Validator / Task Gate
```

- Document Graph 描述文档节点、权威类型和依赖关系；
- Context Router 根据任务意图和变更路径生成必读上下文；
- Docs Impact Report 记录每个关联文档是否更新以及原因；
- Validator 和 Task Gate 把约定变成可执行控制。

### 2.1 资产角色与交付链路

物理目录按稳定资产角色划分，而不是按可变状态或“实现前、中、后”划分：

```text
docs/
├── sources/      # Brainstorm、Finding、Incident、Research、Reference
├── delivery/     # Backlog、Active Task、Archived Task
├── knowledge/    # Decision、Current、Guidance
└── meta/         # Template、Schema 和控制面资产
```

业务流转是：

```text
Sources → Backlog → Active Task → Closed Task → Archived Task
                           │
                           └──> Knowledge Update
```

Source 可以产生多个 Backlog；Backlog 被调度后才创建 Task。Task Runtime 的 `queued`、`blocked`、`verifying` 等状态写入结构化状态，不形成目录。

目录组织决策见 [ADR-0002](../../decisions/adr/0002-organize-docs-by-lifecycle-role.md)。

## 3. 为什么不能只依赖 README

不同 Agent、IDE 和自动化入口对 README 的读取行为并不一致。即使读取了 README，也不能保证继续打开第二层或第三层关联文档。

正确入口不应依赖 Agent 自觉，而应由任务派发器确定：

```text
Task Intent + Planned Change Paths + Document Graph
    ↓
Context Plan
    ↓
注入 TaskEnvelope
```

`AGENTS.md` 仍然有价值，但它是仓库级默认契约，不是唯一控制手段。

## 4. Document Graph

### 4.1 存储

`docs/graph.yaml` 是统一机器可读来源，替代原来的平面文档清单。登记范围包含根入口、`docs/**/*.md` 和项目级 `.agents/skills/**/*.md`，因此操作 Skill 也进入同一依赖图，而不是藏在文档体系之外。

图谱包含：

- Entry Points；
- Document Nodes；
- Typed Relations；
- Intent Routing；
- Path Routing；
- Impact Policy。

### 4.2 节点

每个文档节点至少包含：

```yaml
id: task-runtime-kernel
path: docs/knowledge/current/architecture/task-runtime-kernel.md
type: detailed-design
status: draft
scope: task-runtime
authority: current-design
read_when: [task-runtime-change, workflow-change]
```

`authority` 用于防止不同类型文档相互冒充：

| Authority | 含义 |
|---|---|
| `current-design` | 当前设计意图 |
| `accepted-decision` | 已接受决策 |
| `idea-input` | 尚待验证和消费的需求、假设或开放问题 |
| `external-reference` | 外部资料登记，只能作为参考 |
| `analysis` | 内部调研和阶段性分析 |
| `finding` | Bug、缺陷或异常发现 |
| `incident-record` | 一次故障事件和处置历史 |
| `backlog` | 已识别但尚未进入执行生命周期的工作 |
| `task-artifact` | 某个 Task 的局部 Spec、计划或执行产物 |
| `known-risk` | 已知陷阱 |
| `operational-procedure` | 可执行操作步骤 |
| `code-navigation` | 当前代码导航 |

### 4.3 关系

推荐关系类型：

| 关系 | 示例含义 |
|---|---|
| `routes_to` | 入口导航到内部索引 |
| `indexes` | 目录索引包含文档 |
| `refines` | 详细设计细化总体架构 |
| `governs` | ADR 约束某个架构方案 |
| `informs` | Research 为 ADR 提供证据 |
| `warns_about` | Pitfall 描述某设计的风险 |
| `maps_implementation_of` | CodeMap 映射设计的实际实现 |
| `implements_slice_of` | PoC 实现总体设计的一个切片 |
| `supersedes` | 新 ADR 或文档替代旧版本 |

关系是有向语义，但影响审阅默认可以双向传播。例如 ADR 变化需要审阅 Architecture；Architecture 变化也需要确认对应 ADR 是否仍然有效。

### 4.4 图谱不是全文知识库

Document Graph 保存稳定的显式关系，不保存所有正文实体。全文检索、Embedding 和 LLM Retrieval 可以建立在图谱之上，但不能代替图谱中的权威关系。

## 5. Context Router

### 5.1 输入

```yaml
ContextRequest:
  task_id: "..."
  intents:
    - restate-poc
  planned_paths:
    - src/restate/services.ts
```

### 5.2 输出

```yaml
ContextPlan:
  graph_revision: 5
  required_read:
    - agent-contract
    - docs-index
    - codemap
    - task-runtime-kernel
    - restate-poc-architecture
    - adr-0001-restate-poc
  required_review:
    - architecture-overview
    - durable-runtime-pitfalls
```

`required_read` 是开始实现前必须加载的文档；`required_review` 是任务关闭前必须判断是否受影响的文档。

### 5.3 路由来源

Router 合并四类输入：

1. Baseline：每个 Agent Task 都要读取；
2. Intent：例如 `restate-poc`、`incident-response`；
3. Path Rule：根据预计或实际修改路径；
4. Graph Neighbor：沿指定关系扩展一跳影响面。

PoC 阶段只扩展一跳，避免上下文爆炸。更深依赖通过后续 Router 评估决定，而不是一次性加载整张图。

## 6. Docs Impact Report

Task 完成时必须提交 Docs Impact Report，而不是简单回答“是否更新文档”。

```yaml
task_id: "task-..."
graph_revision: 1
intents: [restate-poc]
changed_paths:
  - src/restate/services.ts

docs:
  read:
    - task-runtime-kernel
    - restate-poc-architecture
  reviewed:
    architecture-overview:
      outcome: unchanged
      reason: "PoC 未改变总体边界"
    codemap:
      outcome: updated
      reason: "新增 workflow 模块"
```

每个 `required_review` 文档都必须有处置结果：

- `updated`：已经随任务更新；
- `unchanged`：检查后不需要变化，并说明理由；
- `not_applicable`：路由命中但不适用，并说明理由。

“没有更新文档”不再是缺省状态，而是一个需要解释的显式结论。

## 7. Task 生命周期集成

### 7.1 开始 Gate

Task 从 `SCOPED` 进入 `PLANNED/EXECUTING` 前：

1. 识别 Intent；
2. 预测变更路径或模块；
3. 固定 `graph_revision`；
4. 生成 ContextPlan；
5. 将 Required Read 注入 TaskEnvelope；
6. 记录 `TaskContextPlanned` Event。

Agent 即使没有主动打开 README，也会收到 Runtime 生成的上下文清单。

### 7.2 运行中刷新

如果实际修改路径超出最初计划：

1. 发送 `TaskScopeExpanded`；
2. Router 使用新增路径增量计算；
3. 新文档加入 Required Read/Review；
4. Agent 在继续高风险修改前加载新增上下文。

### 7.3 关闭 Gate

Task 进入 `CLOSED` 前：

1. 使用最终 changed paths 重新执行 Router；
2. 对比 Task 开始时 ContextPlan；
3. 验证 Required Read 已读取；
4. 验证 Required Review 均有 disposition；
5. 验证新 Markdown 已登记且不是孤儿节点；
6. 执行链接和图谱校验；
7. 保存 Docs Impact Report Artifact；
8. 产生 `DocumentationImpactAccepted` Event。

### 7.4 归档 Gate

Task 业务关闭后，再执行独立 Archive：

1. 确认 Task 已处于业务终态；
2. 确认不存在 Active Attempt，外部副作用已经对账；
3. 冻结 Spec Revision、验证证据、结果和 Closure Report；
4. 确认 Docs Impact 已接受；
5. 归档或清理 Worktree；
6. 将 Task 包移入 `docs/delivery/tasks/archive/YYYY-MM-DD-TASK-NNNN/`；
7. 保持 `task_id` 不变，只更新图谱中的路径和 `archive_status`；
8. 产生 `TaskArchived` Event。

Archive 失败只能重试 Archive，不能重新执行编码、验证或 Merge。

## 8. 更新传播规则

关联不意味着所有文档必须同步修改，否则会造成无意义文档 churn。正确规则是：

> 关联文档必须被 Review；是否 Update 由文档权威、变化语义和明确理由决定。

示例：

| 变化 | 必须 Review | 常见 Update |
|---|---|---|
| Workflow 状态语义变化 | Task Runtime、ADR、Pitfall、CodeMap | Task Runtime、CodeMap |
| 仅移动代码文件 | CodeMap、相关 Architecture | CodeMap |
| 新的技术选型 | Research、ADR、Architecture | ADR、Architecture |
| 发现可复现 Bug | Finding、Backlog、相关 Architecture | Finding、Backlog |
| 真实线上恢复失败 | Incident、Backlog、Runbook、Pitfall | Incident、Backlog；后两者按影响更新 |
| Research 出现新候选 | 相关 ADR | Research；ADR 未必变化 |

## 9. 控制等级

### Level 0：导航

README、目录索引和相对链接。

### Level 1：Agent 契约

`AGENTS.md` 要求执行 Router 和 Docs Impact 检查。

### Level 2：本地工具

```bash
ruby scripts/docs_graph.rb validate
ruby scripts/docs_graph.rb route --intent restate-poc --path src/restate/services.ts
ruby scripts/docs_graph.rb validate-impact --report docs/meta/templates/docs-impact.yaml
ruby scripts/docs_graph.rb related --doc task-runtime-kernel
ruby scripts/docs_graph.rb mermaid
```

项目 Agent 也可以使用 `.agents/skills/moye-task-control/SKILL.md` 和 `npm run cli -- route ...`。Skill 只编排这些确定性命令，不能自行修改图谱结果或 Task Runtime 状态。

### Level 3：CI Gate

未来在 PR/CI 中：

- 根据 Git diff 获取 changed paths；
- 重新计算 ContextPlan；
- 验证 Docs Impact Report；
- 阻止孤儿文档、断链和未处置影响进入主干。

### Level 4：Task Runtime Gate

Moye 能够自举执行后，由 Workflow 自动生成 ContextPlan，并在 Task Close 前强制 Docs Impact Gate。CI 是第二道保护，不是唯一入口。

## 10. 陈旧性控制

图谱解决关联问题，但不能自动判断正文是否正确。后续可以增加：

- `validated_against_commit`：文档最近验证的代码版本；
- `tracked_paths`：文档声称覆盖的代码范围；
- `content_digest`：生成型 CodeMap 的输入摘要；
- `review_after`：时间型复审日期；
- `owner`：领域维护者；
- `supersedes`：版本替代关系。

这些字段应在真实需要出现后增加，PoC 阶段避免一次构建完整企业知识平台。

## 11. 知识提升路径

文档图谱同时承担知识治理骨架：

```text
Reference ──> Research ──> ADR ──> Architecture
Brainstorm ─┐
Finding ────┼──> Backlog ──> Task ──> Knowledge Update
Incident ───┘          │
                       └──> Archived Task

Incident ──> Pitfall / Runbook
Code + Tests ──> CodeMap
```

自动化可以推荐关系和更新候选，但不得让 Agent 未经 Gate 直接把一次任务经验提升为 Accepted ADR 或当前 Architecture。

## 12. PoC 验收标准

- 所有 Markdown 文档都在图谱中登记；
- 每个非索引文档至少有一条关系；
- 图谱关系不存在失效节点；
- 可以根据 Intent 和 Path 输出 ContextPlan；
- 新增关联文档后 Router 能将其带入 Review；
- Docs Impact Report 对每个 Required Review 有明确处置；
- Source 能转化为 Backlog，Backlog 能绑定到 Active Task；
- Closed Task 只有通过 Archive Gate 后才进入归档目录；
- 本地校验器可以检查图谱、链接和孤儿文档；
- 未来 TaskEnvelope 可以直接承载 ContextPlan，而不依赖 Agent 是否阅读 README。
