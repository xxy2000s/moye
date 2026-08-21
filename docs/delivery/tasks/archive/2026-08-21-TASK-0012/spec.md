# TASK-0012 Spec：将 Agent Events 改为独立弹窗

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0013

## 目标

把 Agent Events Viewer 从任务详情正文中的内联区域拆成独立弹窗。用户可以专注浏览完整事件流，关闭后无损返回原任务详情；数据来源、安全边界和 Task 状态权威均保持不变。

## Requirements

### REQ-0012-01：独立事件弹窗

- 任务详情只保留“查看 Agent Events”入口，不再渲染展开后的事件正文；
- 点击入口后打开独立、位于任务详情之上的 Event Dialog；
- Event Dialog 展示 Task、Attempt、Runner、加载进度和完成状态；
- 关闭 Event Dialog 后恢复任务详情，不关闭或重建 Task Detail。

### REQ-0012-02：完整交互能力不回退

- 保留全部、对话、工具调用、工具结果、系统、错误筛选；
- 保留原始 JSON 展开、cursor 分页、运行中轮询、加载全部和原始 JSONL 下载；
- 每次打开新的 Task 时清空旧 Task 的 Event Viewer 状态；
- 关闭事件弹窗时停止轮询，重新打开时从该 Task 的当前事件快照加载。

### REQ-0012-03：可访问性与布局

- Event Dialog 使用明确标题、关闭按钮和 `aria-modal` 语义；
- Escape 优先关闭最上层 Event Dialog，再由下一次 Escape 关闭 Task Detail；
- 关闭后焦点回到“查看 Agent Events”入口；
- 桌面和窄屏下 Event Dialog 独立滚动，筛选和事件正文可访问。

### REQ-0012-04：验证

- E2E 契约断言 Viewer 是独立 Dialog，而不是 Task Detail 的子节点；
- 真实浏览器验证打开、筛选、关闭、焦点恢复和 17 条真实 Codex 事件；
- `npm run check`、`npm run test:e2e` 与文档门禁通过。

## 非目标

- 不修改 Agent JSONL 采集、cursor API、Artifact 校验或事件分类协议；
- 不增加新的前端框架、路由或全局状态库；
- 不改变 Task、Workflow、Trace 或 Restate 状态所有权。

## 完成定义

真实 Codex Task 的“查看 Agent Events”入口打开独立弹窗，显示完整 17 条事件并支持原有全部能力；关闭后仍停留在同一任务详情，键盘和窄屏交互通过浏览器验收。
