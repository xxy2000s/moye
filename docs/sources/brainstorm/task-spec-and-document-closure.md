# 编码任务 Spec、文档与外围闭环

> 文档类型：Brainstorm  
> 状态：Draft / Partially Consumed  
> 更新日期：2026-08-19  
> 目标消费方：Task Runtime、Document Control Plane、首个编码任务 PoC

> 消费记录：目录角色、Backlog、Active/Archive Task 边界已进入 [ADR-0002](../../knowledge/decisions/adr/0002-organize-docs-by-lifecycle-role.md) 和 [Document Control Plane](../../knowledge/current/architecture/document-control-plane.md)；Spec 最小模型等问题仍保持 Open。

## 1. 背景

Moye 需要同时解决两个不同问题：

1. 一个编码 Task 如何从接收需求一直运行到合入、知识同步和关闭；
2. Task 中产生和消费的 Spec、ADR、Incident、Pitfall、Architecture、CodeMap 等文档如何管理。

现阶段的共识是不能让某个小众 Spec 工具同时承担这两个领域，也不能把所有知识文档都塞进一次编码 Spec。

## 2. 当前共识草案

### 2.1 外围：Task Control Plane

外围系统拥有完整 Task 的权威状态，负责：

- Step、Attempt、Lease 和 Checkpoint；
- Agent/Daemon 派发与交接；
- 中断恢复、重试、Repair 和 Replan；
- Worktree、验证、Review 和 Merge；
- 外部副作用对账；
- Task、Attempt、Spec Revision、Commit 和 Trace 的关联；
- 关闭前的知识同步 Gate。

首个 PoC 暂定使用 Restate 验证 Durable Execution，但 Task 领域模型属于 Moye，不属于 Restate。

### 2.2 内层：编码 Spec 协议

Spec 描述本次代码变更的局部契约，可能包含：

- 需求与非目标；
- 验收标准及稳定 ID；
- 设计和约束；
- 实施任务及依赖；
- 验证计划和证据映射；
- Spec Revision 与变更记录。

OpenSpec 或 GitHub Spec Kit 可以作为作者体验和文件格式候选，但不能成为 Task 主状态的权威来源。SpecD 的部分生命周期和文档图谱思想可以参考，但因项目维护与生态风险，不作为核心依赖候选。

### 2.3 项目级来源与长期知识

Incident 和 Research 属于 Task 可以消费的 Source；ADR、Pitfall、Architecture、CodeMap 和 Runbook 属于跨 Task 持续生效的 Knowledge。它们都不是单个 Spec 的子文件。

一个 Task 可以读取这些资产，也可以在执行后提出 Backlog 或 Knowledge 更新，但必须遵守各自的提升和审核规则。

## 3. 初步边界

```text
Task Runtime（唯一任务状态权威）
    │
    ├── 固定并消费 Spec Revision
    ├── 执行 Agent / Worktree / Verify / Review / Merge
    ├── 产生代码与验证证据
    └── 生成 Document Obligations
             │
             ├── 更新 CodeMap？
             ├── 更新 Architecture？
             ├── 需要 ADR？
             ├── 产生 Incident / Pitfall？
             └── Spec 是否可以归档？
```

原则上：

- Moye 管 Task 状态；
- Spec 工具管变更工件；
- Document Control Plane 管项目知识、关系和影响检查；
- Trace 连接三者，但不替代任何一方的业务状态。

## 4. Document Obligation 假设

Task 在开始和运行过程中生成一组待处置的文档义务。每项义务必须是 `updated`、`unchanged` 或 `not_applicable`，后两者必须带原因。

```yaml
doc_obligations:
  - document: codemap
    trigger: new-module-added
    disposition: required

  - document: architecture
    trigger: component-boundary-changed
    disposition: review_required

  - document: adr
    trigger: durable-dependency-selected
    disposition: review_required
```

代码合入不等于 Task 完成。Task 需要经过 `KNOWLEDGE_SYNC`，确认 Spec、验证证据和关联知识文档已经更新或明确豁免，才能关闭。

## 5. 候选生命周期

以下仅用于讨论，不是已接受状态机：

```text
RECEIVED
  → SPECIFYING
  → READY
  → DISPATCHING
  → EXECUTING
  → VERIFYING
  → REVIEWING
  → MERGING
  → KNOWLEDGE_SYNC
  → DONE
```

Spec 自身可以拥有更小的生命周期：

```text
DRAFT → CLARIFIED → APPROVED → IMPLEMENTING
      → VERIFIED → ACCEPTED → ARCHIVED
```

外围 Task 状态和 Spec 状态需要建立显式映射，但不能合并成同一套状态机。

## 6. 待解决问题

- Spec 的最小 Schema 是什么，哪些字段必须机器可读？
- 一个 Attempt 如何固定 Spec Revision，Spec 变化后哪些 Gate 必须失效？
- OpenSpec 和 Spec Kit 哪一个更适合作为可替换适配器？
- Document Obligation 由路径规则、语义分析还是 Agent 建议产生？
- Architecture、ADR 等高权威文档由谁批准，Agent 能否只创建提案？
- 多个并行 Task 同时更新同一份文档时如何合并和重新验证？
- 文档更新失败时，代码已经合入的 Task 应停在哪个状态？
- 如何从 Requirement 追踪到 Task、Test、Evidence、Commit 和知识更新？
- Brainstorm 被后续任务消费后，如何自动登记去向和剩余开放问题？

## 7. 建议的后续消费任务

1. 从本文抽取“编码 Spec 最小数据模型”Research；
2. 用同一个小需求对比 OpenSpec 和 Spec Kit；
3. 在 Restate PoC 中实现一个最小 `KNOWLEDGE_SYNC` Gate；
4. 将验证结果形成 ADR，再更新 Task Runtime 和 Document Control Plane Architecture。

在以上步骤完成前，本文只作为需求和问题入口，不构成实现约束。
