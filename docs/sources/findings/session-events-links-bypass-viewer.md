# 多角色 Session Events 链接绕过弹窗

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-22  
> 影响范围：Project Board、Agent Events Viewer、多角色 Session 审计

## 观察

TASK-0012 已把 Agent Events Viewer 放入独立 Dialog，TASK-0021 又为 Context、Implementation、Self Review、Independent Review 与 Docs Gate 暴露了各自的 Event URL。但是任务详情中的每条 Session 仍使用普通 `<a target="_blank">` 打开该 URL，只有 Implementation 汇总区的“查看 Agent Events”按钮接入 Dialog。

因此用户从最自然的 Session 明细入口点击时，会离开当前任务详情并看到 JSON/API 响应，体验上等同于跳转或下载，无法在同一个界面按 Chatbot 方式连续阅读，也无法复用现有分类筛选。

## 可重复证据

1. 打开任一包含多个真实 Session 的 Coding Task；
2. 展开“高级诊断”中的角色会话；
3. 点击 Context、Self Review 或 Independent Review 后的“查看原始 Events ↗”；
4. 浏览器在新页面打开 `/api/tasks/<task_id>/roles/<run_id>/events`，没有进入 `agent-events-dialog`；
5. `public/app.js` 的 `roleSessions`、`implementationSessions`、`reviewSessions` 均直接渲染 `<a target="_blank">`。

## 影响

- 多角色事件入口的交互不一致；
- 用户无法在任务详情之上逐个切换 Session 并保持审计上下文；
- 原始 JSON 优先于可理解对话，形成“黑盒文件下载”的感受；
- 已有对话、工具调用、工具结果、系统、错误筛选只有部分入口可达。

## 修复边界

统一所有 Session Event 入口到同一个独立 Dialog；Dialog 采用 Chatbot 消息流呈现，并保留分类筛选、实时轮询、cursor 分页、原始 JSON 下钻与次要下载动作。Event API、Artifact 安全校验和 Workflow 状态所有权不变。
