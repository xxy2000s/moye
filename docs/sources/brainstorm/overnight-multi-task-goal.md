# 夜间多 Task 自举开发目标

> 文档类型：Brainstorm  
> 状态：Draft / Ready for Task Decomposition  
> 更新日期：2026-08-20  
> 目标消费方：下一轮 Goal、BL-0008、BL-0002 的实现 Task

## 目标

在一次约 8–9 小时的连续 Goal 中，不执行一个不可审计的超大 Task，而是顺序完成多个具备独立 Spec、验证、Git 提交和归档结果的 Task。

目标纵向链路是：

```text
Backlog 文档同步
  → Task / Spec / Step / Attempt 协议
  → Worktree 与本地 Git Effect
  → AgentRunner 与 Codex Exec Adapter
  → 编码 Workflow、Verification 与 Merge
  → Trace、故障恢复与闭环验收
```

## Backlog 映射

### BL-0008

第一个 Task 消费 [BL-0008](../../delivery/backlog/BL-0008.yaml)，实现 Git Backlog YAML 到 ProjectBoard Projection 的显式幂等同步。

### BL-0002

后续 Task 顺序消费 [BL-0002](../../delivery/backlog/BL-0002.yaml)，分别交付：

1. Spec、TaskEnvelope、Step 和 Attempt 最小协议；
2. Worktree、Checkpoint 和本地 Git Effect；
3. Fake AgentRunner 与 Codex Exec Adapter；
4. 编码 Workflow、Verification Gate 和本地 Merge；
5. 基础 Trace、故障注入和完整闭环验收。

一个 Backlog 可以产生多个 Task；每个实际 Task 创建后再把稳定 `task_id` 写入 Backlog 的 `resolution.task_refs`。本文不预先创建或伪造 Active Task 状态。

### 本轮不消费

- BL-0003：完整 Repair、Replan 与中央预算；
- BL-0004：多 Daemon 调度与跨节点交接；
- BL-0005：远程 Git Provider 和 PR/Merge；
- BL-0006：生产级 Telemetry 与运营告警；
- BL-0007：完整知识提升与反馈系统。

BL-0002 中的基础 Task Trace 属于编码闭环验收，不代表 BL-0006 已完成。

## 执行约束

- Task 必须顺序执行；前一个 Task 的验证、文档门禁和本地提交完成后才能开始下一个；
- Goal 模式是当前自举阶段的外层执行器，不能伪造 Moye Runtime 已经执行了尚不支持的编码步骤；
- 所有 Bootstrap 行为必须如实记录实际执行者、命令、Commit 和验证证据；
- 真实 Codex Smoke Test 只能作用于临时 Fixture Git 仓库，不能让嵌套 Agent 直接修改 Moye 主仓库；
- 不向远程仓库 Push，不影响工作区外的仓库、容器和服务；
- 不以耗尽时间为完成标准，以多个 Task 的真实闭环为完成标准。

## 完成判断

- 文档 Backlog 可以显式同步并显示在 Web 看板；
- 一个 Fixture 编码需求可以经过 Worktree、Agent、验证和本地 Merge；
- 进程中断或未知 Git 结果可以恢复或对账；
- 从 `task_id` 可以找到 Step、Attempt、Agent Session、Commit 和验证证据；
- 每个完成的 Task 都有独立提交和归档证据；
- 最终本地 `master` 干净，且没有遗留测试进程、Worktree 或容器。

## 审核策略

如果执行环境支持子 Agent，使用只读 Review Agent 在以下边界审核：

1. Task 创建前：核对 BL-0008、BL-0002 与 Task 切片的映射，并确认 BL-0003 至 BL-0007 没有越界进入实现；
2. Backlog Sync 完成后：核对 Schema 转换、数据所有权、幂等和删除策略；
3. Worktree / Git 完成后：核对路径安全、Base 漂移、Effect ID 和未知结果 Reconcile；
4. 编码 Workflow 完成后：核对主状态所有权、Agent 边界、验证证据和 Merge 唯一性；
5. Goal 结束前：核对文档影响、测试证据、归档真实性和残留资源。

Review Agent 只能报告问题，不能直接修改文件。主执行者必须验证审查结论，只修复真实问题。

## 提示词

```text
在 /Users/xiaxu/service/moye 中执行“夜间多 Task 自举开发目标”。持续推进约 8–9 小时，但以多个 Task 的真实闭环为完成标准，不为消耗时间制造工作。

权威输入：

- AGENTS.md
- .agents/skills/moye-task-control/SKILL.md
- docs/graph.yaml 中的 coding-task-poc 路由
- docs/sources/brainstorm/overnight-multi-task-goal.md
- docs/sources/findings/backlog-docs-not-projected.md
- docs/delivery/backlog/BL-0008.yaml
- docs/delivery/backlog/BL-0002.yaml
- Router 输出的全部 required_read

开始时：

1. 检查 Git HEAD、工作区、Active Task、Worktree、Moye 进程和测试容器；不要重置或覆盖已有变更。
2. 运行：npm run cli -- route --intent coding-task-poc --intent task-create --path docs/delivery/tasks/TASK-0002/task.yaml
3. 读取全部 required_read，记录 required_review。
4. 如果支持子 Agent，启动只读 Review Agent 审核 Backlog→Task 映射、范围、依赖和自举真实性；Review Agent 不得编辑文件。

Backlog 与 Task 映射：

- TASK-0002 消费 BL-0008：Backlog YAML 到 ProjectBoard 的显式幂等同步。
- TASK-0003 消费 BL-0002：Spec、TaskEnvelope、Step 与 Attempt。
- TASK-0004 消费 BL-0002：Worktree、Checkpoint 与本地 Git Effect。
- TASK-0005 消费 BL-0002：Fake AgentRunner 与 Codex Exec Adapter。
- TASK-0006 消费 BL-0002：编码 Workflow、Verification Gate 与本地 Merge。
- TASK-0007 消费 BL-0002：基础 Trace、故障恢复与完整闭环验收。

如果 Task ID 已被真实占用，按顺序使用下一个空闲 ID并同步所有引用，不得覆盖已有 Task。

BL-0008 转换后写入实际 task_refs。BL-0002 可以产生多个 task_refs，每个 Task 真正创建时再追加。不得预先伪造 Task。BL-0003 至 BL-0007 本轮不进入完整实现；TASK-0007 的基础 Trace 不代表 BL-0006 已完成。

严格按 TASK-0002 到 TASK-0007 顺序执行。一个 Task 的实现、验证、文档影响、本地提交和真实关闭条件完成后，才能进入下一个。

每个 Task 必须：

1. 创建或恢复独立 Active Task Package，至少包含 task.yaml、spec.md、plan.md、verification.md、docs-impact.yaml；复杂任务增加 design.md。
2. 在实现前按实际预计路径执行 Context Router，并读取全部 required_read。
3. 使用隔离分支或 Worktree，不让执行 Agent 直接修改 master。
4. 按 Backlog acceptance_outline 和本文能力切片编写稳定 Requirement ID、非目标和验收证据映射。
5. 实现后运行相关单测、集成测试、E2E 和 npm run check。
6. 根据最终 Git Diff 重新执行 Router，并对全部 required_review 记录 updated、unchanged 或 not_applicable 及原因。
7. 创建清晰、可审计的本地 Git Commit；不向任何远程仓库 Push。
8. 不直接编辑 Runtime 主状态，不通过移动目录或修改 task.yaml 伪装关闭或归档。
9. 只有满足真实业务关闭、验证、文档和外部副作用对账条件后，才能通过 Archive Gate。
10. 恢复干净 master 后自动进入下一个 Task，不等待用户确认。

TASK-0002 必须实现 BL-0008 的全部 acceptance_outline，包括字段和枚举转换、批次校验、幂等 Upsert、源文件消失策略、Projection-only Web 查询、转换单测和真实 Restate 集成证据。完成后 BL-0002 至 BL-0007 应能在 Web Backlog 列显示，CONVERTED_TO_TASK 仍按现有规则隐藏。

TASK-0003 只实现最小编码任务协议：稳定 task_id、spec_revision、base_sha、Requirement ID、argv 验证命令、Context Plan、不可变 TaskEnvelope、固定 Pipeline Step、独立 Attempt、Spec Revision 绑定和证据失效规则。不要提前实现 Worktree 或真实 Agent。

TASK-0004 实现隔离 Worktree 和本地 Git Effect：记录 Base、Branch、Checkpoint、Result Commit 和 tree digest；Git 使用 argv 与 shell=false；覆盖路径逃逸、重复执行、Base 漂移、冲突及未知结果 Reconcile。不要提前接入真实 Codex。

TASK-0005 实现可替换 AgentRunner、确定性 Fake Runner 和 Codex Exec Adapter；保存 JSONL、Session ID、最终消息、退出码、耗时和日志 Artifact。自动化测试使用 Fake Runner；真实 Codex 只能运行在临时 Fixture Git 仓库，不得直接修改 Moye 主仓库。

TASK-0006 串联 CONTEXT→WORKSPACE→IMPLEMENT→VERIFY→MERGE→DOCS→CLOSED→ARCHIVE。Workflow 是主状态唯一写入者；验证命令使用 argv 与 shell=false；验证失败禁止 Merge；只能合并已验证的确定 Commit；Merge 使用稳定 Effect ID并能通过 Commit ancestry 对账未知结果。完成 Fake Runner E2E 和一次真实 Codex Fixture Smoke Test，且只合入一次 Fixture master。

TASK-0007 完成看板 Trace 和故障恢复验收：从 task_id 能找到 Step、Attempt、Agent Session、Branch、Commit、验证证据和恢复动作；区分业务 Event、Restate Journal 和技术日志；故障测试覆盖 Agent 异常退出、Service 重启、Git 已完成但 Step 未确认、重复命令和验证失败。更新 README、Runbook、Architecture、CodeMap，并清理 Fixture、Worktree、子进程和测试容器。

自举阶段必须如实记录实际执行者、命令、Commit 和证据。真实 Coding Workflow 尚未具备时，不得假装现有 Demo Workflow 执行了编码工作；不满足 Archive 条件的 Task 保持明确 Active/Blocked，先修复缺失能力再通过正常 Gate 收敛。

在本文“审核策略”规定的五个边界调用只读 Review Agent。主执行者验证其结论并修复真实问题。

不要实现多 Daemon、远程 Git Provider、完整 Repair/Replan、生产级 Telemetry、鉴权、多租户或完整知识反馈系统。不要修改 TASK-0001 的历史事实，不影响工作区外的仓库、容器或服务，不删除测试、不弱化断言、不绕过 Gate。

完成一个 Task 后自动进入下一个。遇到真实缺陷时记录 Finding并转入 Backlog。只有需要外部凭证、不可逆操作授权或无法从仓库事实判断的产品决策时，才报告阻塞。

如果 TASK-0002 至 TASK-0007 全部提前完成，可以从 BL-0003 中再拆一个只覆盖错误分类与 BudgetLedger 领域模型的小 Task，不得扩张到完整 Repair/Replan。

最终报告必须列出：完成/阻塞/未开始 Task、每个 Task 对应 Backlog、Commit、测试和归档位置、Review Agent 结论与处置、看板启动方式、真实 Codex Fixture 证据、故障恢复和唯一 Merge 证据、文档门禁结果、剩余限制、master 状态、残留资源以及未执行远程 Push的确认。

持续推进，直到多 Task 目标完成，或出现当前权限和仓库上下文无法消除的真实阻塞。
```
