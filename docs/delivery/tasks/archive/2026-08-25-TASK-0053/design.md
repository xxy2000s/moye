# TASK-0053 Design

> 状态：Accepted

## 信息层级

页面级 Header 是 Task 身份、Workflow kind、角色参与和最终状态的唯一常驻摘要。画布 Tab 不再重复一张业务结论卡；Graph 工具栏只保留路径筛选、缩放和一个 Event / Projection 一致性标识。

正常状态采用渐进披露：一致时只显示 `Event / Projection 一致`。只有不一致时才在 Graph 前显示高优先级差异面板，并列出业务、Archive、整体落点和 Event 重建四项事实。完整四项事实无论是否一致，都保存在“Workflow 状态事实”Tab。

## Graph 几何

不再让 Core v2 以外的 Workflow 共享同一个 `1640×760` 通用画布：

- 基础 Task / Sealed Task 使用单行业务路径和独立 Archive 分区，不绘制不存在的 Recovery 背景；
- Coding Task 使用单行主路径、只包围 Reconcile / Failed 的紧凑 Recovery 分区和独立 Archive 分区；
- Core v2 继续使用 TASK-0051 已验证的紧凑布局。

几何分支只改变 SVG 坐标和浏览器容器高度，不改变 Definition 中的节点、边、traversed 标记或 Event History。

## 事实边界

基础 Task Header 从 Trace 中读取真实 Workflow 名称，并明确显示 `无 Agent Session`。是否有多 Agent 只由 Role Session 事实证明，不从标题、Task 来源或历史任务类型推断。
