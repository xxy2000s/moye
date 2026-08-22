# TASK-0022 Spec：将全角色 Events 改为可筛选的 Chatbot 弹窗

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0023

## 目标

用户从任何真实 Session 点击 Events 时，都在任务详情之上打开同一个 Chatbot 风格 Event Dialog。消息流优先呈现可读对话和工具过程，原始 JSON/JSONL 只作为下钻证据，不再成为默认落点。

## Requirements

### REQ-0022-01：统一 Session 入口

- Context、Implementation、Self Review、Independent Review、Replan 与 Docs Gate 的每条 Session 使用按钮打开 Event Dialog；
- 不使用新标签页或直接下载作为 Session Events 的默认交互；
- 弹窗标题明确当前 Role、Session、Revision/Attempt 和 Runner；
- 可以关闭当前 Session 并无损返回原 Task Detail，焦点返回原按钮。

### REQ-0022-02：Chatbot 消息流

- 对话事件渲染为 Agent/User 消息气泡；
- 工具调用、工具结果、系统与错误使用不同的语义卡片和清晰身份标签；
- 默认显示摘要，完整原始 JSON 保留在每条消息的折叠详情内；
- 长命令和长输出可换行、滚动，不撑破弹窗。

### REQ-0022-03：筛选与实时跟随

- 顶部提供全部、对话、工具调用、工具结果、系统、错误六类筛选和实时数量；
- 切换筛选只改变呈现，不删除已加载事件；
- 运行中按 cursor 自动追加并保持“实时跟随中”；
- 已完成 Session 支持加载后续、加载到末尾和次要的“下载原始 JSONL”。

### REQ-0022-04：可访问性与验证

- 所有 Events 按钮有明确可访问名称、`aria-haspopup="dialog"` 和可见焦点；
- Filter 使用 `aria-pressed`，弹窗关闭后恢复焦点；
- 桌面和窄屏下内容区域独立滚动；
- 自动化契约禁止 Session Events 回退为 `<a target="_blank">`；
- 真实 Board 浏览器验证至少一个全流程任务的多个 Session 和分类筛选。

## 非目标

- 不采集当前 Runner 未输出的隐藏 Prompt、思维过程或 Raw Model IO；
- 不修改 Event API、Artifact 摘要、安全白名单或 cursor 协议；
- 不改变 Task、Workflow、Attempt、Trace 或 Archive 状态所有权；
- 不引入前端框架或新的运行时依赖。

## 完成定义

真实 Coding Task 的每条角色/实现/审查 Session 都能从当前任务详情打开同一个可筛选 Chatbot Event Dialog；点击不跳页，消息可读，原始证据仍可核对，键盘和窄屏交互通过验收。
