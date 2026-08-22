# TASK-0019 Design

## 产品与测试边界

产品提交协议使用独立的 Live Task 输入，runner 是必填枚举且只接受真实 CLI Adapter。`FakeAgentRunner`、Scenario Adapter 和故障夹具留在测试构造器中，不由 Board/API 路由到达。

## 单一主 Workflow

同一 `task_id/spec_revision` 只由一个 keyed `CodingTaskWorkflow` 持有业务 Projection。Workflow 组合现有 Coding Attempt、Review/Finding、Verification、Git Merge、文档处置和 Archive 协议；Git/CLI/验证作为内容寻址 Effect 接入，不创建第二套隐式业务状态机。通用 `CoreClosureWorkflow` 仍是确定性控制协议 PoC，不冒充本产品路径的真实执行者。

## Role Runner

Implementation Prompt 带冻结 TaskEnvelope、目标、当前 Attempt 和已有 Finding；Codex/Claude Adapter 保留 CLI 原始事件。Review 使用新的 CLI Session、只读权限和结构化 Verdict/Finding Schema；Implementation/Repair 使用 workspace-write。每次执行使用稳定 Intent，已确认 Artifact 可复用，UNKNOWN 必须先 Reconcile。

## Git 与观察

Worktree 是执行缓存，Result Commit 和 Artifact 是迁移状态。Workflow 在独立 Review 和验证通过后提交/合入；Board 只读 Runtime Projection，并通过真实 Artifact API 提供 Agent Events。
