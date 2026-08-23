# Core v2 历史 Recovery Projection 导致 Trace 详情返回 500

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-23

TASK-0042 对 `TASK-CORE-V2-LIVE-001～004` 完成 append-only Failure Closure 与 Archive 后，Board 已把它们正确投影为 `CLOSED + FAILED_TERMINAL + ARCHIVED`。但请求这些任务的 Trace API 时，状态机投影把旧 schema 中未出现的 `mergeReceipt` 当成非空对象并读取 `effectId`，导致详情接口返回 HTTP 500。

该问题只影响只读 Trace/详情，不改变 Restate Journal、TaskAuthority、原 Workflow、Recovery successor 或 Archive Receipt。修复必须兼容不可改写的历史 Projection：缺失的 nullable 字段按 `null` 处理，并用旧 schema 回归用例证明详情构建不会抛错；不得通过补写 Runtime Projection 解决。
