# Core v2 Observer 拒绝已失效 Revision 的合法历史 Attempt

> 文档类型：Finding
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23
> Runtime Task：`TASK-ACCEPT-20260823102846-02-FINAL-REVIEW`

真实 Replan 预算耗尽 Task 已合法完成 Failure Closure 与 Archive，但 Board Trace 返回 500：`Observer Attempt scope mismatch`。确定性 Observer 只接受 `attempt.specRevision === projection.specRevision`，因此当前 Revision 为 R2 时会错误拒绝 R1 的 Architect/Design Review 历史 Attempt，失败详情无法查询。

历史 Attempt 并非 stale 覆盖；它们必须保留用于解释 Replan。TASK-0043 将 Observer scope 改为“当前 Revision + `invalidatedRevisions` 明确登记的 Revision”，仍拒绝其他 Task、未来 Revision 或未登记 Revision。修复只改变只读事实汇总，不推进 Task，也不修改 Runtime Projection。

修复后原失败归档 Task 的 Trace API 恢复为 200；新的 `TASK-ACCEPT-20260823111330-02-DESIGN-REPLAN` 同时展示 Revision 1 和 Revision 2 的九个真实 Role Session，并保持 `CLOSED / SUCCEEDED / ARCHIVED`。
