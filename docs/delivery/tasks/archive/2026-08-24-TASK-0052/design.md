# TASK-0052 Design

> 状态：Accepted

## Board 时间事实

前端只读取 Board Task 已有的 `events` 和 `archiveStatus`，不新增 Projection 字段，也不改写 Runtime。首条 Event 的 `at` 是开始时间；`archiveStatus === ARCHIVED` 时最后一条 Event 的 `at` 是结束时间；其他状态没有结束时间。Duration 使用同一对时间计算，运行中以 Board `generatedAt` 为观察时刻。

卡片使用紧凑三列 definition list，保持任务标题和业务状态仍是主要层级。时间使用本地化短格式，duration 使用天、小时、分钟、秒的可扫读格式。

## 详情页信息架构

详情内容顶部增加单一 `tablist`：

1. 画布：任务结论、失败摘要、Closure 与状态机 Graph；
2. 角色与交付物：Role/Agent Session、Attempt、Artifact 和关联链；
3. Workflow 状态事实：Domain Event 时间线；
4. 高级诊断：确定性 Observer、Restate Journal、恢复建议、技术 Artifact 与原始定位信息。

四个 panel 始终在 DOM 中，由 `hidden` 控制可见性；这保证切换只影响呈现，不改变或重新请求业务事实。Tab 状态是浏览器瞬时 UI 状态，不属于 Task Projection。

## 可访问性与刷新

按钮使用 WAI-ARIA Tab 语义并实现 roving `tabindex`。鼠标点击和键盘切换统一进入同一激活函数。同一 Task 的 5 秒自动刷新保留当前 Tab；打开另一个 Task 时重置为画布。
