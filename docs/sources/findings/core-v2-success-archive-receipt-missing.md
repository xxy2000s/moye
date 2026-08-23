# Core v2 成功路径把 CLOSED 映射为 ARCHIVED 但没有 Archive Receipt

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-23

真实 Task `TASK-CORE-V2-MERGE-UNKNOWN-005` 完成七个 Role、Verification Gate 和真实 Merge UNKNOWN 对账后得到 `CLOSED + SUCCEEDED`，Board/事件显示 `ARCHIVED`，但 `lifecycle.archive` 为 `null`，没有 Success Closure Artifact、Archive Effect identity 或 Archive Receipt Digest。

当前结果只能证明 Merge/Reconcile 成功，不能作为完整成功 Archive 的产品证据。成功路径必须像失败路径一样显式执行 Closure 与独立 Archive Effect；Archive 失败只允许 Archive-only retry，`boardTask()` 不得仅凭 `state === CLOSED` 推导已归档。
