# Core v2 Reconcile 验收把不同时点 Projection 相等误当成幂等

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23

真实 `ROLE_NOT_APPLIED` Task 已完成失败 Closure/Archive，但 recovery harness 把第一次 resolve signal 返回的 `WAITING_RECONCILE` Projection 与任务完成后相同 Evidence 重放返回的最终 `CLOSED` Projection 做全量 JSON 相等比较，错误报告“不幂等”。

幂等性的产品约束是：相同 token/action/evidence 重放不产生新 Event、Attempt、Role Run、Test、Commit、Merge 或 Archive Effect，并返回当前权威 Projection；它不要求两个不同时点的查询快照字节相同。修复后 harness 以最终 Projection Digest、Event/Attempt/Run 数量不变为判据，并继续验证冲突 Evidence 被拒绝。
