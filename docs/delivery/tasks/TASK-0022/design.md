# TASK-0022 Design

## 交互结构

```text
Task Detail
  ├── Context Session ───────────┐
  ├── Implementation Session ───┤
  ├── Self Review Session ──────┼──> Agent Events Dialog
  ├── Independent Review ───────┤       ├── Session Header
  ├── Replan Session ───────────┤       ├── Category Filters
  └── Docs Gate Session ────────┘       ├── Chat Transcript
                                          └── Cursor / Raw JSONL actions
```

所有入口只传入 Trace 已提供的受控 `eventsUrl` 和展示元数据。Dialog Controller 每次打开创建独立状态，关闭时终止旧轮询；不会从 DOM 或 URL 猜测 Artifact 路径。

## 消息呈现

- `conversation`：根据事件内可见 role/type 标记 User 或 Agent，使用对话气泡；Runner 没有输出 User Prompt 时不虚构人的消息；
- `tool`：工具调用卡片，突出命令/操作名称；
- `tool_result`：工具结果卡片，突出完成状态和输出摘要；
- `system`：时间线式系统通知；
- `error`：高对比错误卡片；
- malformed JSON：归入错误并保留原始文本。

每条消息保留 sequence、Event Type 和“查看原始 JSON”折叠项。分类由服务端 Event Page 提供，前端只做显示筛选。

## 可访问性

- Session 入口使用真实 `<button>`，最小点击区域 44px，提供 `aria-haspopup`/`aria-controls`；
- Filter 使用可见焦点和 `aria-pressed`；
- 原生 Dialog 提供 Escape、modal focus boundary，关闭后恢复触发按钮；
- 使用文字身份与形状区分类型，不只依赖颜色。

## 不变量

- Viewer 仍只读，不推进 Workflow；
- 下载仍需完成态和 Artifact 摘要验证；
- 打开新 Session 必须停止前一 Session 的 poll timer；
- Task Detail 自动刷新在 Event Dialog 打开期间暂停，避免重建触发按钮和丢失焦点。
