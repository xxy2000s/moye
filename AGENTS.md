# AGENTS.md

本文件是所有在 Moye 仓库中工作的编码 Agent 的仓库级操作契约。它描述进入仓库后的阅读顺序、事实来源、变更纪律和完成标准。

## 1. 开始任何任务前

按顺序阅读：

1. `README.md`；
2. `docs/README.md`；
3. `docs/graph.yaml`；
4. `docs/knowledge/current/codemap/README.md`；
5. 与任务相关的 Source、Backlog、Architecture、ADR、Pitfall 和 Runbook。

不要把历史对话作为唯一上下文。影响实现的结论必须能在仓库文档、代码、测试或 Task Artifact 中找到。

开始实现前，使用任务意图和预计修改路径生成 Context Plan：

```bash
ruby scripts/docs_graph.rb route --intent <intent> --path <planned-path>
```

也可以通过统一 CLI 执行：

```bash
npm run cli -- route --intent <intent> --path <planned-path>
```

必须阅读输出中的 `required_read`；`required_review` 在任务结束前逐项判断影响。入口不是从 README 进入时，也必须执行该路由。

## 2. 事实来源

发生冲突时按以下方式处理：

- 可执行行为由代码和测试证明；
- 当前设计意图由 Architecture 描述；
- 已经接受的取舍由 ADR 解释；
- 代码位置和依赖由 CodeMap 导航；
- Reference 只提供外部参考，不构成项目事实；
- Brainstorm 只提供待消费的需求、假设和开放问题，不构成实现依据；
- Finding 记录 Bug、缺陷或异常发现，经 Backlog 去重和调度后才形成 Task；
- Incident 记录一次真实故障及处置历史，并可拆出多个 Backlog；
- Research 只提供内部分析和候选方案，不代表已经决定；
- Backlog 表示已识别但尚未进入执行生命周期的工作；
- Pitfall 描述已知风险，不自动形成实现要求；
- Runbook 描述操作步骤，不定义系统架构。

如果代码与 Architecture 冲突，不要静默选择一方。确认是实现漂移还是文档过期，并在同一个变更中修复对应来源。

## 3. 核心架构不变量

所有实现必须遵守：

1. Task 是完整研发生命周期的业务聚合根。
2. 只有 Workflow 可以推进 Task 主状态。
3. Step 的每次实际执行都是独立 Attempt。
4. Agent、Daemon 和进程内存不属于持久化 Task 状态。
5. 新执行者必须能够从 Event、TaskEnvelope、Checkpoint 和 Artifact 接管任务。
6. 旧 Lease 的执行者不能覆盖新 Attempt 的结果。
7. 未知外部副作用必须先 Reconcile，不能盲目重试。
8. Retry、Repair 和 Replan 必须分别建模。
9. Worktree 是执行缓存；Git 和 Artifact 才是可迁移状态。
10. Trace 用于诊断，不能替代业务 Event 和 Task State。

详细说明见 `docs/knowledge/current/architecture/task-runtime-kernel.md`。

## 4. 文档影响检查

每次代码变更结束前，明确判断以下文档是否需要更新：

| 变化 | 必须检查 |
|---|---|
| 新增、删除或移动模块 | CodeMap |
| 改变系统边界、数据流或不变量 | Architecture |
| 引入重大技术或产品取舍 | ADR |
| 产生尚未验证、需要后续消费的需求或方案 | Brainstorm |
| 发现 Bug、缺陷或异常现象 | Finding、Backlog |
| 处理一次真实故障事件 | Incident、Backlog |
| 登记外部资料或形成内部调研分析 | Reference、Research |
| 发现稳定复现的陷阱或反模式 | Pitfalls |
| 改变构建、部署、恢复或排障步骤 | Runbooks、README、AGENTS |

如果不需要更新，仍要在 Docs Impact Report 中为关联文档记录 `unchanged` 或 `not_applicable` 及原因，而不是写一个无法验证的全局 `docs-impact: none`。

## 5. 文档写入规则

- Architecture 描述当前有效设计，不保存大段方案比较。
- ADR 一旦 Accepted，不重写历史论证；变化通过新 ADR supersede。
- Reference 必须记录来源、访问日期和适用范围，不能直接声明项目结论。
- Brainstorm 必须标注 Draft，正式消费后记录提升去向，不能直接冒充实现约束。
- Research 必须标注调研日期，引用 Reference 或一手资料，并区分来源信息和项目推论。
- Finding 和 Incident 只记录真实发现，不创建虚构示例；后续工作进入 Backlog。
- Backlog 不复制完整 Task Spec；调度时由稳定引用绑定到 Active Task。
- Active Task 直接放在 `docs/delivery/tasks/`；只在通过 Archive Gate 后移入 `archive/`。
- `execution_mode: sealed-result-commit` 的 Task 使用两阶段 Seal：Workflow 先生成 Intent 并等待；执行者在 Commit 前把最终 package 移入 Intent 指定的 Archive 路径，Result Commit 后只能提交 Evidence，Workflow 不再改写 Git。目录位置本身不代表 Task 已关闭。
- Pitfall 必须包含触发条件、后果、检测方法和规避方式。
- CodeMap 只记录当前存在的代码；规划结构必须明确标注 Planned。
- 所有新文档加入 `docs/graph.yaml`、至少建立一条语义关系，并加入对应目录索引。
- 跨文档使用相对链接，链接目标必须存在。

文档变更后运行：

```bash
ruby scripts/docs_graph.rb validate
```

任务结束时基于 `docs/meta/templates/docs-impact.yaml` 形成 Docs Impact Report，并运行：

```bash
ruby scripts/docs_graph.rb validate-impact --report <report-path>
```

## 6. 实现纪律

- 在没有可靠 Task Runtime 前，不自行实现第二套隐式状态机。
- 所有可能重复执行的外部操作必须有幂等键或对账路径。
- 不把 Prompt、聊天历史或 Worker 本地路径当作唯一持久化信息。
- 不在 PoC 中提前实现与验证目标无关的平台功能。
- 新增依赖、框架或基础设施前先检查是否需要 ADR。
- 测试优先覆盖中断、重试、重复投递和未知结果，而不只覆盖 Happy Path。

## 7. 当前 PoC 范围

当前有效决策见 `docs/knowledge/decisions/adr/0001-use-restate-for-task-runtime-poc.md`。

PoC 必须验证：

- Durable Step 在进程重启后恢复；
- 已完成的昂贵操作不重复；
- Attempt 和 Worker 接管关系可追踪；
- 至少一个外部副作用通过 Effect Record 对账；
- 可以从 `task_id` 找到 Workflow 和 Trace；
- 随机终止执行者后得到唯一结束状态。

PoC 不负责证明 Restate 是最终生产选型。

## 8. 完成标准

一次实现任务只有在以下条件满足后才算完成：

- 目标行为已经实现；
- 相关测试或可重复验证命令通过；
- 失败路径按风险得到验证；
- 没有留下未说明的临时状态和后台进程；
- 文档影响检查完成；
- Docs Impact Report 覆盖 Router 计算出的所有 `required_review`；
- CodeMap 与实际目录一致；
- 重要决策、风险或故障进入正确文档类型；
- 结果中列出验证证据和剩余限制。

Core v2 自举 Task 还必须满足：Result Commit 的唯一父提交是 Manifest 冻结的 `base_commit`；代码、文档、验证、Docs Impact 和 sealed Archive package 位于同一个 Commit；Seal Gate 通过后工作树仍为 clean。Result Commit SHA 记录在 Runtime Receipt，不写回同一 Commit。

## 9. 项目 Skill 与运行入口

仓库内的 `.agents/skills/moye-task-control/SKILL.md` 是 Agent 操作 Task 和文档门禁的最小流程。它只能调用 CLI、Runtime API 和文档图谱，不能直接改写 Runtime 状态。

稳定命令：

```bash
npm run cli -- --help
npm run check
npm run test:e2e
```

本地 Runtime 操作遵循 `docs/knowledge/guidance/runbooks/local-restate-poc.md`。直接运行代码前仍必须先完成 Context Route。
