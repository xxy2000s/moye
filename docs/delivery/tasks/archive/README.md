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
