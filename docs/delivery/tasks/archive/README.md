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

TASK-0002 的 `task.yaml` 冻结在 Archive 开始前，因此其中 `archive.status: pending` 描述的是冻结点；最终 `ARCHIVED` 事实由目录位置、`archive-manifest.json` 和 ProjectBoard Projection 共同证明。归档后文档图门禁发现 Spec 的 Active 相对链接因目录层级变化而失效，控制面只修正了该链接；修正前内容仍由 Result Commit `ff1954f4e4360e85276cf22aa30d6f5e8e396f84` 保存。后续 Task 必须使用不随 Active/Archive 深度变化的稳定引用。
