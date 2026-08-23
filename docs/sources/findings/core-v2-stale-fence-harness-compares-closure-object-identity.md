# Core v2 stale-fence 验收错误比较 Closure 对象引用

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-24

`TASK-GRD-20260823194304-04-STALE-FENCING` 已成功归档，错误 Digest 被拒绝，G0 Manifest 得到 `STALE_GENERATION`，相同请求重放也返回相同结果。验收器在两次独立 HTTP `status` 响应之间使用 JavaScript 对象引用相等比较 `successClosure`，因此两个内容相同但反序列化为不同对象的 Closure 被误报为 Projection mutation。失败任务使用 `null === null`，所以同一错误没有在预算场景暴露。

修复后比较 `projectionDigest`、`successClosure.closureDigest` 和 `failureClosure.closureDigest`。Harness 以显式 re-audit 模式附着已归档 Task，重放同一只读 fencing 请求并生成 Evidence Summary；没有重提 Workflow、重跑 Agent/Test/Commit/Merge，也没有修改 Projection。
