# Core v2 Board 混淆 Runtime Outcome、归档处置与验收历史

> 文档类型：Finding
> 状态：Resolved by TASK-0046
> 发现日期：2026-08-23
> 影响范围：Project Board、Core v2 Trace、Task Audit UX

## 观察

`ProjectBoard` 保存的通用 `TaskProjection` 会把 Core v2 的 `WAITING_RECONCILE`、`ARCHIVE_PENDING` 与 `ARCHIVE_FAILED` 压缩为 `EXECUTING` 或 `CLOSED`。页面因此只能依赖业务状态与归档字段拼接标签，不能直接解释当前是在执行、等待对账、失败闭环还是仅重试归档。

Board 也没有 Workflow kind、产品验收历史分类与 outcome 筛选。大量真实故障验收 Task 和普通研发 Task 混在同一列，用户难以快速定位最新成功任务，或只查看某类 Workflow/Outcome。状态机画布虽然保留未经过节点，但成功任务的 Failure/Repair/Replan 节点没有足够醒目的“合法但本次未发生”语义。

## 影响

- `ARCHIVE_FAILED` 可能被误读为仍在执行业务步骤；
- `WAITING_RECONCILE` 不能在总览上直接识别；
- 历史产品验收 Task 与普通项目 Task 缺少稳定区分；
- 用户需要逐卡打开才能找到最新成功闭环；
- 合法异常节点容易被视觉样式误读为本次真实失败。

## 边界

修复必须保持 Board 只读。Workflow/Authority/Event History 仍是状态事实来源；验收历史标签只能来自明确输入事实或保守的遗留命名约定，不能扫描 Git/Artifact 或修改 Runtime Projection 制造状态。

## 处置

[TASK-0046](../../delivery/tasks/archive/2026-08-23-TASK-0046/spec.md) 增加显式 Board 运行元数据、TaskAuthority 只读兼容解析、Outcome/Workflow/验收历史筛选和最新成功入口；状态机只点亮 Event History 实际经过的异常节点。持久化 `moye` Board 的 57 个归档 Task、LIVE-001～006 和真实 Role Event 弹窗均已通过浏览器核验，修复过程没有写 ProjectBoard Projection。
