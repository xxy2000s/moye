# Moye 内部文档入口

本目录只保留四个稳定资产角色，文档类型不再直接平铺在 `docs/` 根目录。

```text
Sources → Backlog → Active Task → Archived Task
                           │
                           └──沉淀──> Knowledge

Meta 管理整个文档控制面
```

## 1. 四个入口

| 入口 | 回答的问题 | 主要内容 |
|---|---|---|
| [Sources](./sources/README.md) | 工作从哪里来？ | Brainstorm、Finding、Incident、Research、Reference |
| [Delivery](./delivery/README.md) | 工作如何排队、执行和归档？ | Backlog、Active Task、Archived Task |
| [Knowledge](./knowledge/README.md) | 项目长期知道什么？ | ADR、Architecture、CodeMap、Pitfall、Runbook |
| [Meta](./meta/README.md) | 文档体系如何运作？ | Graph、Schema、Template、治理说明 |

物理目录只表达稳定的资产角色。状态、Sprint、Owner、阶段和优先级写入结构化元数据，并由 `graph.yaml` 和未来看板生成视图。

## 2. 工作与知识流转

```text
Brainstorm / Finding / Incident / Research / Reference
                         ↓
                      Backlog
                         ↓
                    Active Task
                         ↓
          Verify → Merge/Outcome → Knowledge Sync
                         ↓
                   Archived Task
```

- Source 不是待办；它可以产生零个、一个或多个 Backlog Item；
- Backlog 不是 Task；它只表示已识别、待调度的工作；
- Task 拥有 Spec、Attempt、验证、结果和知识同步义务；
- `Closed` 是业务终态，`Archived` 是后续固化和存储动作；
- Archived Task 保留完整上下文，但不再作为活动工作输入。

## 3. 权威关系

不同资产不能互相冒充：

- Reference 只是外部参考；
- Brainstorm 是未收敛输入；
- Finding 是 Bug、缺陷或异常发现；
- Incident 是一次真实故障及其处置历史；
- Research 是内部分析，不代表已接受决策；
- ADR 记录已经接受的重要取舍；
- Architecture 描述当前设计；
- CodeMap 映射当前实现；
- Pitfall 和 Runbook 分别描述风险与操作指导；
- Task Artifact 记录一次执行，不自动成为长期知识。

## 4. 推荐阅读路径

### 初次了解项目

1. [总体架构](./knowledge/current/architecture/overview.md)
2. [Task Runtime Kernel](./knowledge/current/architecture/task-runtime-kernel.md)
3. [ADR 索引](./knowledge/decisions/adr/README.md)
4. [CodeMap](./knowledge/current/codemap/README.md)

### 开始 Restate PoC

1. [ADR-0001：使用 Restate 开展首个 PoC](./knowledge/decisions/adr/0001-use-restate-for-task-runtime-poc.md)
2. [Restate PoC 架构](./knowledge/current/architecture/poc-01-restate.md)
3. [Durable Workflow 调研](./sources/research/durable-workflow-and-observability-options.md)
4. [Durable Task Runtime Pitfalls](./knowledge/guidance/pitfalls/durable-task-runtime.md)

### 消费输入或创建任务

1. 从 [Sources](./sources/README.md) 找到来源；
2. 在 [Backlog](./delivery/backlog/README.md) 去重、分类和初步澄清；
3. 调度后在 [Tasks](./delivery/tasks/README.md) 创建 Active Task；
4. 通过 Archive Gate 后移入 [Archived Tasks](./delivery/tasks/archive/README.md)。

## 5. 文档登记与命名

`graph.yaml` 是机器可读的文档注册表和知识图谱。详细机制见 [Document Control Plane](./knowledge/current/architecture/document-control-plane.md)。

新增 Markdown 时必须加入图谱、建立语义关系、加入相关入口，并运行：

```bash
ruby scripts/docs_graph.rb validate
```

命名规则：

- Backlog 使用 `BL-NNNN.yaml`；
- Active Task 使用 `TASK-NNNN/`；
- Archived Task 使用 `YYYY-MM-DD-TASK-NNNN/`；
- ADR 使用 `NNNN-short-title.md`；
- Incident 使用 `YYYY-MM-DD-short-title.md`；
- 其他文档使用小写英文和连字符。

## 6. Task 文档闭环

每个 Task 开始时生成 Context Plan，关闭前提交 Docs Impact Report。最终变更路径必须重新路由，所有关联文档都需要明确 `updated`、`unchanged` 或 `not_applicable`。

当前使用 `scripts/docs_graph.rb` 执行路由和校验；未来由 Moye Task Runtime 在 Task Start、Scope Change、Close 和 Archive Gate 中自动执行。
