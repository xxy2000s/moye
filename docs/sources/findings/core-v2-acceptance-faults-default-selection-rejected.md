# Core v2 Fault Acceptance 默认场景选择被错误拒绝

> 文档类型：Finding
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23

TASK-0043 完成分场景真实验收后，首次不设置 `MOYE_CORE_V2_ACCEPTANCE_SCENARIOS` 运行 `npm run acceptance:core-v2:faults` 时，Harness 在创建任何 Runtime Task 前报错：`MOYE_CORE_V2_ACCEPTANCE_SCENARIOS contains an unknown or duplicate scenario`。

根因是过滤器校验无条件比较默认五场景列表与空的用户请求列表。修复后，只有用户显式提供过滤器时才检查未知或重复值；空过滤器必须选择全部五个故障场景。原命令失败发生在 Workflow 提交前，没有生成或覆盖 Runtime Task。最终以同一条未筛选命令完整通过作为修复证据。

复验证据：未设置 `MOYE_CORE_V2_ACCEPTANCE_SCENARIOS` 的命令创建 `TASK-ACCEPT-20260823114251-01` 至 `-05` 五个独立 Task，全部 `CLOSED / SUCCEEDED / ARCHIVED`；矩阵汇总为 `.moye-runtime/acceptance/core-v2/faults-20260823114251-64463/matrix-summary.json`。
