# ADR-0002：按生命周期角色组织项目文档

> 状态：Accepted  
> 日期：2026-08-19  
> 决策者：项目 Owner  
> 关联文档：[Document Control Plane](../../current/architecture/document-control-plane.md)、[Brainstorm](../../../sources/brainstorm/task-spec-and-document-closure.md)

## Context

原有 `docs/` 直接按 Architecture、ADR、Research、Incident、Pitfall 等文档类型平铺。目录数量随着知识类型增加而持续增长，也没有表达 Source、Backlog、Task 和长期知识之间的消费关系。

按“实现前、实现中、实现后”划分同样不稳定：同一份 Architecture、ADR 或 Runbook 会跨越多个阶段，Task 状态变化也会导致频繁移动目录。

## Decision Drivers

- 根目录必须保持少量、稳定且容易理解的入口；
- Source、Backlog、Task 和长期知识需要建立显式消费链路；
- Task 的活动包和归档包需要直观分离；
- 可变状态不能导致文档频繁移动和链接漂移；
- 文档的权威性不能仅由目录位置推断。

## Considered Options

1. 继续按文档类型在 `docs/` 根目录平铺；
2. 按实现前、实现中、实现后划分；
3. 按资产角色划分为 Sources、Delivery、Knowledge 和 Meta；
4. 所有内容放入单层目录，仅依赖搜索和图谱。

## Decision

采用四个稳定资产角色：

```text
docs/
├── sources/      # Brainstorm、Finding、Incident、Research、Reference
├── delivery/     # Backlog、Active Task、Archived Task
├── knowledge/    # Decision、Current、Guidance
└── meta/         # 模板和文档控制面资产
```

Delivery 使用以下主链路：

```text
Sources → Backlog → Active Task → Closed Task → Archived Task
```

`delivery/tasks/` 直接保存 Active Task，`delivery/tasks/archive/` 保存已经通过 Archive Gate 的历史包。Runtime 的排队、阻塞、验证等状态只写入 Task State 和 `task.yaml`，不形成物理目录。

`Closed` 表示业务生命周期结束，`Archived` 表示历史包已经冻结和迁移。Archive 是可重试的独立动作，失败不能重新触发编码执行。

文档继续使用稳定 ID 和 `docs/graph.yaml` 建立关系；路径变化只更新注册表，不改变业务身份。

## Consequences

### Positive

- `docs/` 根目录入口从多个文档类型收敛为四个资产角色；
- Backlog 和 Task 成为文档闭环中的显式对象；
- Incident、Finding、Reference 和 Research 不再被混为通用 Evidence；
- Active 与 Archive 对人类和 Agent 都直观可见；
- 阶段、状态、Owner 和 Sprint 可以通过元数据生成不同视图。

### Negative

- 文档路径变深，相对链接需要由校验器保护；
- Archive 移动 Task 目录时必须更新图谱映射；
- 需要额外维护 Backlog、Task 和 Archive 模板。

### Risks

- Agent 仍可能按旧路径查找文档；通过更新 README、AGENTS、CodeMap、Graph Router 和链接校验缓解；
- 把 Git 中的 Task 文档误当成完整 Runtime 数据库；Task Event、Attempt 和 Effect 的权威状态仍属于 Task Runtime。

## Validation

- `docs/` 根目录只保留四个主要资产目录和统一入口；
- 图谱校验覆盖全部 Markdown 和相对链接；
- Router 能按新路径加载 Architecture、Source、Backlog 和 Task 上下文；
- 可以创建一个 Backlog、转化为 Active Task，并在关闭后只重试 Archive 动作。

## Supersession

- Supersedes：无；
- Superseded by：无。
