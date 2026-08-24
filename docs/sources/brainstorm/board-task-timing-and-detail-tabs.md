# Board Task 时间与详情分层需求

> 文档类型：Brainstorm / Product Requirement
> 状态：Promoted
> 提出日期：2026-08-24
> 正式消费方：[BL-0063](../../delivery/backlog/BL-0063.yaml)、[TASK-0052](../../delivery/tasks/archive/2026-08-24-TASK-0052/spec.md)

## 需求

1. Board 上的每张 Task 卡片直接显示开始时间、结束时间和 duration；
2. Task 详情页顶部使用局部小 Tab 分层，顺序固定为“画布”“角色与交付物”“Workflow 状态事实”“高级诊断”；
3. 进入详情页默认展示“画布”，其他证据按 Tab 切换，不删除、不伪造 Runtime 事实；
4. Tab 必须支持键盘操作和窄屏横向滚动。

## 事实边界

Task 时间只从 Board Projection 中已有的 Domain Event 派生。第一条 Event 是开始时间；只有 Archive 已完成的 Task 才显示结束时间。未结束 Task 的 duration 按 Board 刷新时刻累计并明确标记“运行中”。

## 消费结果

本需求已提升为 TASK-0052 的可执行 Spec；该 Source 保留用户原始产品意图，不作为 Runtime 状态来源。
