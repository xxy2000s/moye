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
| [BL-0002](./BL-0002.yaml) | Ready | 实现首个真实单 Agent 本地编码闭环 | — |
| [BL-0003](./BL-0003.yaml) | Triaged | 实现 Repair、Replan 与中央重试预算 | — |
| [BL-0004](./BL-0004.yaml) | Triaged | 实现多 Daemon 调度、租约与安全交接 | — |
| [BL-0005](./BL-0005.yaml) | Triaged | 接入远程 Git Provider 与 PR/Merge 闭环 | — |
| [BL-0006](./BL-0006.yaml) | Triaged | 建设生产级 Trace、运营指标与异常看板 | — |
| [BL-0007](./BL-0007.yaml) | Triaged | 实现经验候选、知识提升与效果反馈闭环 | — |

新建时复制 [`backlog-item.yaml`](../../meta/templates/backlog-item.yaml)，文件名使用 `<backlog-id>.yaml`。
