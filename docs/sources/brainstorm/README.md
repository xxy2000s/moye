# Brainstorm：需求与想法孵化区

本目录保存讨论过程中出现、但尚未经过调研、决策或详细设计的需求、假设和开放问题。它是后续 Research、ADR、Architecture 和实现 Task 的消费入口。

## 定位

Brainstorm 允许内容不完整、存在冲突和继续变化。目录中的内容默认都是 **Draft**，不代表 Moye 已经接受相关方案，也不能直接覆盖 Architecture 或 ADR。

```text
讨论与想法
  → Brainstorm
  → Research / Prototype
  → ADR（形成重要决策时）
  → Architecture / Task Spec
  → Implementation
```

后续任务消费 Brainstorm 时，应明确记录结果：

- `promoted`：结论已经进入 Research、ADR、Architecture 或 Task Spec；
- `partially_consumed`：只吸收了其中一部分；
- `superseded`：被新的 Brainstorm 或正式文档替代；
- `rejected`：经过验证后不采用，并链接原因；
- `open`：仍待讨论。

Brainstorm 不要求每次讨论都立即收敛，但不能被 Agent 当作当前系统事实。正式实现仍以 Architecture、Accepted ADR、代码和测试为准。

## 当前草稿

- [Moye 外部项目框架化需求基线](./external-project-framework-productization.md)：记录 Core v2 作为 Framework Kernel 的现状、外部项目接入缺口、Framework MVP 完成定义和生产阶段边界，已进入 BL-0068 等待拆分实现。
- [Board Task 时间与详情分层需求](./board-task-timing-and-detail-tabs.md)：记录 Task 卡片时间事实与详情页四 Tab 的用户需求，已提升为 BL-0063 / TASK-0052。
- [Core v2：5+1 Agent 研发闭环需求基线](./core-v2-five-plus-one-agent-requirements.md)：修订后的 Core 母需求，固定五类主流程 Agent、非阻塞 Observer/Knowledge、独立 Test/Verification 与确定性 Gate。
- [多 Agent 研发 Core 闭环需求基线](./multi-agent-core-closure-requirements.md)：当前 Core First 的母需求入口，固定 Orchestrator、Docs、Implementation、Review、Observer 多角色边界，并拆出 ControlDecision、Repair/Replan、Docs Impact 和统一 Closure 验收。
- [Task 全生命周期与 Worktree 收束](./task-lifecycle-and-worktree-convergence.md)：历史 Brainstorm；保留完整 Harness、Worktree 收束和 Restate 边界讨论，当前 Core 路线和 REQ-LC 拆分已被需求基线取代。
- [编码任务 Spec、文档与外围闭环](./task-spec-and-document-closure.md)：拆分 Task Control Plane、编码 Spec 协议和长期知识文档，并探索如何通过文档义务形成关闭 Gate。
- [夜间多 Task 自举开发目标](./overnight-multi-task-goal.md)：固定下一轮 Goal 的 Backlog 映射、顺序能力切片、自举约束和完成边界。

## 写作约定

- 文件名使用小写英文和连字符；
- 开头标明状态、更新时间和目标消费方；
- 优先记录需求、约束、假设和开放问题，不急于写成正式方案；
- 外部资料进入 Reference，基于资料和实验形成的内部分析进入 Research；
- 已经接受的取舍进入 ADR；
- 当前有效设计进入 Architecture；
- 被正式文档消费后保留原文，并补充去向链接，不回写成“最终设计”。
