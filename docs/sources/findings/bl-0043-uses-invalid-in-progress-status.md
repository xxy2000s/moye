# BL-0043 使用了 Backlog 状态机不存在的 in_progress

> 文档类型：Finding
> 状态：Confirmed / Fixed by TASK-0041
> 发现日期：2026-08-23

TASK-0041 全量 `npm run test:e2e` 在 Backlog 原子同步门禁中拒绝 `docs/delivery/backlog/BL-0043.yaml`：`in_progress` 不是合法 Backlog document enum；文档值必须使用小写的 `captured | triaged | ready | scheduled | converted_to_task | deferred | duplicate | rejected`。

该条目已存在 Active/Planned Task，因此语义正确的 Backlog 状态是 `scheduled`；Task 自身的执行中状态继续由 Task Manifest/Runtime 表达，不能混入 Backlog 状态机。门禁继续发现 BL-0044～0047 使用了非 schema 的扩展 kind，统一按真实缺陷改为 `bug`，具体领域分类继续由 title/affected areas 表达。
