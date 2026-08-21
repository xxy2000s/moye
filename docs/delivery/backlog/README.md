# Backlog

Backlog 是 Sources 与可执行 Task 之间的归一化工作队列。每个条目使用稳定 ID，例如 `BL-0014`。

```text
CAPTURED → TRIAGED → READY → SCHEDULED → CONVERTED_TO_TASK
                └──> DEFERRED / DUPLICATE / REJECTED
```

Backlog Item 只需要表达问题、优先级、来源、影响范围和粗粒度验收方向，不应提前复制完整 Task Spec。

## 当前条目

| ID | 状态 | 标题 | Task |
|---|---|---|---|
| [BL-0001](./BL-0001.yaml) | Converted | 实现可恢复 Task 生命周期、Archive 与项目看板 | TASK-0001 |
| [BL-0002](./BL-0002.yaml) | Converted | 实现首个真实单 Agent 本地编码闭环 | TASK-0003～TASK-0007 |
| [BL-0003](./BL-0003.yaml) | Converted | 实现 Repair、Replan 与中央重试预算 | TASK-0016 |
| [BL-0004](./BL-0004.yaml) | Triaged | 实现多 Daemon 调度、租约与安全交接 | — |
| [BL-0005](./BL-0005.yaml) | Triaged | 接入远程 Git Provider 与 PR/Merge 闭环 | — |
| [BL-0006](./BL-0006.yaml) | Triaged（部分消费） | 建设生产级 Trace、运营指标与异常看板 | TASK-0017（Core 子集） |
| [BL-0007](./BL-0007.yaml) | Triaged（部分消费） | 实现经验候选、知识提升与效果反馈闭环 | TASK-0017（Core 子集） |
| [BL-0008](./BL-0008.yaml) | Converted | 将 Backlog 文档幂等同步到项目看板 | TASK-0002 |
| [BL-0009](./BL-0009.yaml) | Converted | 让一键 Demo 展示可理解的编码任务与 Agent 流转 | TASK-0008 |
| [BL-0010](./BL-0010.yaml) | Converted | 实现轻量 Agent Runtime Trace 与 Phoenix Demo | TASK-0009 |
| [BL-0011](./BL-0011.yaml) | Converted | 在 Moye 看板内联查看 Agent Events | TASK-0010 |
| [BL-0012](./BL-0012.yaml) | Converted | 接入真实 Agent 完整事件流与交互看板 | TASK-0011 |
| [BL-0013](./BL-0013.yaml) | Converted | 将 Agent Events 改为独立弹窗 | TASK-0012 |
| [BL-0014](./BL-0014.yaml) | Converted | 实现 Core ControlDecision 与确定性控制内核 | TASK-0013 |
| [BL-0015](./BL-0015.yaml) | Converted | 统一 Docs、Implementation 与 Review Role Attempt 协议 | TASK-0014 |
| [BL-0016](./BL-0016.yaml) | Converted | 实现 Self Review、ReviewResult 与 Finding 生命周期 | TASK-0015 |
| [BL-0017](./BL-0017.yaml) | Converted | 将最终 Docs Impact 与 Knowledge Sync 接入 Core Workflow | TASK-0017 |
| [BL-0018](./BL-0018.yaml) | Ready | 实现统一 Core Closure Gate 与故障收敛矩阵 | — |
| [BL-0019](./BL-0019.yaml) | Triaged | 修复 CLI close 未附着既有 TaskWorkflow | — |

## 本轮调度结果

连续 Goal 已先通过 TASK-0002 消费 BL-0008，再通过 TASK-0003 至 TASK-0007 顺序消费 BL-0002。具体能力切片、范围排除和自举约束见 [夜间多 Task 自举开发目标](../../sources/brainstorm/overnight-multi-task-goal.md)，最终证据从 [Archived Tasks](../tasks/archive/README.md) 查询。

Backlog 的 `resolution.task_refs` 只登记实际创建过的稳定 Task ID；它不替代 Runtime Task 状态，执行与归档事实仍以 Task Projection 和归档证据为准。

多 Agent Core 闭环按母需求的六个 Slice 顺序调度：BL-0014、BL-0015、BL-0016、BL-0003、BL-0006/BL-0007/BL-0017、BL-0018。Slice 1～4 已归档，Slice 5 已创建 TASK-0017；BL-0006/BL-0007 只部分消费并保留生产范围，Slice 6 完成前置 Task 后再绑定真实 Task ID。

新建时复制 [`backlog-item.yaml`](../../meta/templates/backlog-item.yaml)，文件名使用 `<backlog-id>.yaml`。
