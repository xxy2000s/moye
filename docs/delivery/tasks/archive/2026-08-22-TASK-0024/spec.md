# TASK-0024 Spec：居中画布优先的 Task 审计工作区

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0025

## 目标

把 Task Detail 从纵向证据长页重构为居中的审计工作区。默认首屏只保留紧凑 Task 摘要、状态机工具栏和完整 Graph，总览不自动打开节点详情；用户选择节点后，桌面端在右侧展开 Inspector，移动端从底部展开 Sheet。实际 History 收入画布底部的可展开事实栏，完整 Agent Events 继续使用独立 Chatbot 弹窗。

## Requirements

### REQ-0024-01：居中总览工作区

- Task Detail 使用接近全视口的居中 Dialog，具有稳定 Header、Graph Workspace 和底部事实栏；
- 默认打开时 Graph 是首屏主体，Task 结论和关联链压缩为 Header/Summary，不在画布前堆叠长区块；
- Graph 初始自动适配并居中，完整 Definition、路径筛选、缩放和图例仍可访问；
- 详细 Step、Role、Diagnostic 内容放在总览之后或明确折叠，不挤压首屏。

### REQ-0024-02：按需节点详情

- 默认不打开节点 Inspector；点击或键盘激活节点才打开；
- 桌面端 Inspector 固定在工作区右侧，画布通过布局分栏让出空间而不是被遮挡；
- 关闭 Inspector 后保留当前 Filter、Zoom 和画布滚动位置；
- Inspector 继续从同一 `definition/history/executions` 派生入边、出边、Event、Attempt、Session 与 Evidence。

### REQ-0024-03：移动端 Bottom Sheet

- 窄屏使用 Bottom Sheet 呈现节点详情，不保留不可读的右侧窄栏；
- Sheet 有明确标题、关闭按钮和受控内部滚动；
- Graph 只在自己的 viewport 内横向浏览，页面根节点不产生横向溢出；
- 触控目标至少 44px，并支持键盘、可见焦点与 `prefers-reduced-motion`。

### REQ-0024-04：事实与对话分层

- 实际转换 History 默认收为画布底部摘要，可展开查看完整文本事实；
- Execution、Role、高级诊断保留完整内容，但不抢占默认 Graph 总览；
- 查看 Session Events 继续打开独立 Chatbot Dialog，Filter、cursor 增量与焦点返回行为不退化；
- 布局状态只存在于前端内存，不写入或推断 Runtime 状态。

## 非目标

- 不改变 Workflow、Projection、Event、Attempt、Archive 或 Trace API；
- 不允许从 Graph、Inspector 或 History 推进、回滚、重试 Task；
- 不引入 React、D3、第三方 Drawer/Dialog 或布局依赖；
- 不删除文本 History、Execution、Role 或高级诊断证据；
- 不把 Agent Events 内嵌到节点侧栏以替代独立 Chatbot Dialog。

## 完成定义

在真实成功和失败 Coding Task 上，打开详情默认看到居中完整 Graph；节点详情仅在选择后以桌面侧栏或移动 Bottom Sheet 出现，关闭后上下文保持；实际路径文本与 Agent Chatbot 均能继续审计，自动化、桌面和窄屏真实浏览器验收通过。
