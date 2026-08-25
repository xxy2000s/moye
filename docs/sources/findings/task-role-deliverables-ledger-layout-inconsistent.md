# 角色与交付物 Tab 在简单任务和多角色任务中密度失衡

> 文档类型：Finding
> 状态：Resolved by TASK-0054，等待 Result Commit Seal
> 发现日期：2026-08-25
> 影响范围：Task Audit、角色会话、生命周期 Artifact、响应式布局

## 观察

真实 `TASK-0053` 的“角色与交付物”Tab 只显示一块宽幅空状态、`无 Agent Session` 说明和本地归档绝对路径。页面没有把 Sealed Result Commit、Task Package 和 Archive 解释为系统交付物，导致简单任务既显空，又让低价值路径占据主要视觉层级。

真实 `TASK-ACCEPT-20260823175744-01-HAPPY` 默认纵向展开 7 个 Role Session 大卡片和 9 个 Lifecycle Artifact 原始记录。每张 Session 都重复展示完整 Session ID、摘要和相同操作按钮；Artifact ID 与 Digest 使用极小等宽字铺满页面。角色与交付物被拆成两段后，同一阶段的执行者和产物需要上下往返匹配。

Coding Trace 还在同一 Tab 重复绘制完整阶段 Journey；该流程已经由“画布”Tab 表达，进一步放大了页面高度。

## 影响

- 简单任务被错误呈现为“空”，系统执行事实和真实交付结果不可扫读；
- 多角色任务随 Session 和 Artifact 数量增长形成超长页面；
- `19px` 衬线分区标题、`12–14px` 正文和 `9px` 原始标识混用，视觉层级跳跃；
- 原始 ID 比角色结论、Revision、Generation 和交付物关系更醒目；
- 画布、角色 Tab 和高级诊断之间出现职责重复。

## 边界

修复只重组浏览器内的只读 Trace 呈现，不改变 Role Session、Lifecycle Artifact、Attempt、Workflow Definition、Event History 或 Runtime Projection。完整标识与历史证据仍必须可查询；Agent Events 继续通过现有 Chatbot 弹窗读取。

后续工作进入 [BL-0065](../../delivery/backlog/BL-0065.yaml)。

## 处置

`TASK-0054` 将 Core v2、Coding 与基础 Task 的角色/交付结果归一化为只读 Execution Ledger。多角色任务默认只展开一个选中角色，完整技术证据渐进披露；无 Agent 的 Sealed Task 改为紧凑系统执行摘要。真实 `TASK-0053` 与 Core v2 Happy Task 的桌面、窄屏和 Agent Events 弹窗已经验证，最终 Result Commit 与 Archive Receipt 记录在对应 Task Package。
