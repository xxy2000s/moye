# Archived Tasks

本目录保存已经完成 Archive Gate 的 Task 历史包，目录名使用：

```text
YYYY-MM-DD-TASK-NNNN
```

所有业务结果都可以归档，包括 `succeeded`、`cancelled` 和 `failed_terminal`。结果写入 `task.yaml` 的 `outcome`，不能通过目录名推断。

归档包原则上不可变。需要补充审计说明时创建新的附属记录并建立关系，不重写原始执行证据。

## 已归档 Task

| Task | Outcome | Archived At | 目标 |
|---|---|---|---|
| [TASK-0001](./2026-08-20-TASK-0001/spec.md) | Succeeded | 2026-08-20 | 可恢复 Task 生命周期、Archive 与项目看板 |
| [TASK-0002](./2026-08-20-TASK-0002/spec.md) | Succeeded | 2026-08-20 | Backlog 文档幂等同步与真实自举关闭 |
| [TASK-0003](./2026-08-20-TASK-0003/spec.md) | Succeeded | 2026-08-20 | Spec、TaskEnvelope、Step、Attempt 与 Evidence 协议 |
| [TASK-0004](./2026-08-20-TASK-0004/spec.md) | Succeeded | 2026-08-20 | Worktree、Checkpoint 与本地 Git Effect |
| [TASK-0005](./2026-08-20-TASK-0005/spec.md) | Succeeded | 2026-08-20 | Fake AgentRunner 与 Codex Exec Adapter |
| [TASK-0006](./2026-08-20-TASK-0006/spec.md) | Succeeded | 2026-08-20 | 编码 Workflow、Verification Gate 与原子本地 Merge |
| [TASK-0007](./2026-08-20-TASK-0007/spec.md) | Succeeded | 2026-08-20 | 基础 Trace、恢复视图与完整闭环故障验收 |
| [TASK-0008](./2026-08-20-TASK-0008/spec.md) | Succeeded | 2026-08-20 | 可理解的 Coding Demo 与中文 Agent 流转看板 |
| [TASK-0009](./2026-08-21-TASK-0009/spec.md) | Succeeded | 2026-08-21 | 轻量 Agent Runtime Trace 与 Phoenix Demo |
| [TASK-0010](./2026-08-21-TASK-0010/spec.md) | Succeeded | 2026-08-21 | Moye 看板内联 Agent Events Viewer |
| [TASK-0011](./2026-08-21-TASK-0011/spec.md) | Succeeded | 2026-08-21 | 真实 Agent 完整事件流与交互看板 |
| [TASK-0012](./2026-08-21-TASK-0012/spec.md) | Succeeded | 2026-08-21 | Agent Events 独立弹窗 |
| [TASK-0013](./2026-08-22-TASK-0013/spec.md) | Succeeded | 2026-08-22 | Core ControlDecision 与确定性控制内核 |
| [TASK-0014](./2026-08-22-TASK-0014/spec.md) | Succeeded | 2026-08-22 | Docs、Implementation 与 Review 统一 Role Attempt 协议 |
| [TASK-0015](./2026-08-22-TASK-0015/spec.md) | Succeeded | 2026-08-22 | Self Review、ReviewResult 与 Finding 生命周期 |
| [TASK-0016](./2026-08-22-TASK-0016/spec.md) | Succeeded | 2026-08-22 | Retry、Repair、Replan 与中央预算 |
| [TASK-0017](./2026-08-22-TASK-0017/spec.md) | Succeeded | 2026-08-22 | Observer、Docs Impact Gate 与 Knowledge Candidate |
| [TASK-0018](./2026-08-22-TASK-0018/spec.md) | Succeeded | 2026-08-22 | Core ClosureResult 与真实 Restate 故障矩阵 |
| [TASK-0019](./2026-08-22-TASK-0019/spec.md) | Succeeded | 2026-08-22 | 真实 Agent 的页面可用编码闭环 |
| [TASK-0020](./2026-08-22-TASK-0020/spec.md) | Succeeded | 2026-08-22 | 页面可审计的真实 Task 状态机与转换证据 |
| [TASK-0021](./2026-08-22-TASK-0021/spec.md) | Succeeded | 2026-08-22 | 真实 Core 单任务闭环、Web 全程审计与全角色事件流 |
| [TASK-0022](./2026-08-22-TASK-0022/spec.md) | Succeeded | 2026-08-22 | 将全角色 Events 改为可筛选的 Chatbot 弹窗 |
| [TASK-0023](./2026-08-22-TASK-0023/spec.md) | Succeeded | 2026-08-22 | 将完整状态机呈现为实际路径点亮的 Graph 画布 |
| [TASK-0024](./2026-08-22-TASK-0024/spec.md) | Succeeded | 2026-08-22 | 将 Task 详情重构为居中画布优先的审计工作区 |
| [TASK-0025](./2026-08-22-TASK-0025/spec.md) | Succeeded | 2026-08-22 | 补齐状态机节点的执行与系统管控下钻 |
| [TASK-0026](./2026-08-22-TASK-0026/spec.md) | Succeeded | 2026-08-22 | 重构节点 Inspector 并内联 Agent Events 预览 |
| [TASK-0027](./2026-08-22-TASK-0027/spec.md) | Succeeded | 2026-08-22 | 优化状态机边标签与合法路径详情 |
| [TASK-0028](./2026-08-23-TASK-0028/spec.md) | Failed Terminal | 2026-08-23 | 全屏任务审计与持久化已实现；Bootstrap 基线未冻结导致任务失败收敛 |
| [TASK-0029](./2026-08-23-TASK-0029/spec.md) | Succeeded | 2026-08-23 | Bootstrap 预检、失败收敛、历史恢复与 Core v2 Roadmap |
| [TASK-0030](./2026-08-23-TASK-0030/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Core v2 5+1 架构与单 Result Commit Seal 协议 |
| [TASK-0031](./2026-08-23-TASK-0031/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Core v2 九类 Lifecycle Artifact 与精确 Gate |
| [TASK-0032](./2026-08-23-TASK-0032/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | 五类 Agent 与旁路 Observer 共用的真实 Role Runtime v2 |
| [TASK-0032R1](./2026-08-23-TASK-0032R1/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | 错误 Seal Evidence 的 append-only successor recovery |
| [TASK-0033](./2026-08-23-TASK-0033/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Architect、Design Review 与 Revision REPLAN |
| [TASK-0034](./2026-08-23-TASK-0034/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Implementation、Self Review、Checkpoint 与 Repair |
| [TASK-0035](./2026-08-23-TASK-0035/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Documentation Agent 与 Docs Impact Gate |
| [TASK-0036](./2026-08-23-TASK-0036/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Test Verification 与真实 Trusted Runner |
| [TASK-0037](./2026-08-23-TASK-0037/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Final Review 与确定性 Verification Gate |
| [TASK-0038](./2026-08-23-TASK-0038/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | 确定性 Observer 与旁路 Knowledge |
| [TASK-0039](./2026-08-23-TASK-0039/spec.md) | Sealed；业务终态见 Runtime | 2026-08-23 | Core v2 统一 Workflow、CLI、Board 与真实 Agent/Runner/Git 验收 |
| [TASK-0040](./2026-08-23-TASK-0040/spec.md) | Succeeded + Archived via recovery；原失败保留 | 2026-08-23 | Core v2 失败 Closure、Archive 与 LIVE-001～004 合法收敛 |
| [TASK-0040R1](./2026-08-23-TASK-0040R1/spec.md) | Succeeded + Archived via recovery；原失败保留 | 2026-08-23 | append-only 恢复 TASK-0040 Docs Impact Seal 失败 |
| [TASK-0040R2](./2026-08-23-TASK-0040R2/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | 多级 Sealed Recovery chain 与 TASK-0040/TASK-0040R1 合法收敛 |
| [TASK-0041](./2026-08-23-TASK-0041/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | Core v2 真实双父 Merge Effect、未知回执对账与证据边界修复 |
| [TASK-0042](./2026-08-23-TASK-0042/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | Core v2 成功 Closure/Archive、停滞 Workflow successor 与历史 Trace 兼容 |
| [TASK-0042R1](./2026-08-23-TASK-0042R1/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | append-only 恢复 TASK-0042 Verification 状态 Seal 失败 |
| [TASK-0043](./2026-08-23-TASK-0043/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | 真实 Agent Happy、Finding-driven Repair 与 Design Replan 产品验收矩阵 |
| [TASK-0044](./2026-08-23-TASK-0044/spec.md) | Seal Prepared；业务终态见 Runtime | 2026-08-23 | Test UNKNOWN、Role Worker 中断、Git Checkpoint 与 Merge 回执未知真实验收 |

Bootstrap Task 的 `task.yaml` 冻结在 Archive 开始前，因此其中 `archive.status: pending` 描述的是冻结点；最终 `ARCHIVED` 事实由目录位置、`archive-manifest.json` 和 ProjectBoard Projection 共同证明。TASK-0002 归档后文档图门禁曾发现 Spec 的 Active 相对链接因目录层级变化而失效，控制面只修正了该链接；修正前内容仍由 Result Commit `ff1954f4e4360e85276cf22aa30d6f5e8e396f84` 保存。后续 Task 使用不随 Active/Archive 深度变化的稳定引用。
