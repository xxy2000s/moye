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

本文只确定下一轮 Goal 的需求边界和 Backlog 映射，不替代每个 Task 的 Spec、Architecture 或 ADR。
