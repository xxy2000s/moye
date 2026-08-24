# TASK-0052 Spec：补齐 Board Task 时间并重构详情页局部 Tab

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0063](../../../backlog/BL-0063.yaml)

- `REQ-0052-01`：Board 每个 Task 卡片必须显示开始时间、结束时间和 duration；开始时间取首条 Domain Event，完成归档后结束时间取最后一条 Event，未结束时结束时间显示“—”、duration 显示实时累计并标记运行中；
- `REQ-0052-02`：Task 详情页内容顶部必须按顺序提供“画布”“角色与交付物”“Workflow 状态事实”“高级诊断”四个局部 Tab；
- `REQ-0052-03`：首次进入任一 Task 详情时默认选中“画布”；同一 Task 自动刷新不得擅自切回默认 Tab，切换 Task 时重置为画布；
- `REQ-0052-04`：Tab 使用 `tablist / tab / tabpanel` 语义，支持左右方向键、Home、End 和可见焦点；窄屏允许 Tab 条横向滚动；
- `REQ-0052-05`：Core v2、Coding 与基础 Task Trace 的原有画布、Session、Artifact、Domain Event、Restate 和恢复诊断事实不得丢失；
- `REQ-0052-06`：变更必须通过定向测试、真实 Runtime 桌面与窄屏浏览器验收、`npm run check`、`npm run test:e2e`、Docs Impact Gate 和唯一 Sealed Result Commit。
