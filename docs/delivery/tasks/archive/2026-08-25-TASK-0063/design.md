# TASK-0063 Design

Core v2 Role 的 trigger 同时携带 `sessionUrl/timelineUrl/stderrUrl/eventsUrl`。弹窗先取 Session Metadata，使用 Runtime 明确状态决定读取 Timeline、轮询等待或显示不可用；只有旧 Coding/Role 没有 Session Evidence contract 时才进入标为“Execution Stream”的兼容视图。

Canonical event renderer 只消费 `category/actor/origin/parts/correlation/occurredAt`，不调用旧 `eventSpeaker/eventSummary`。筛选层把 PROMPT 与 USER 合为“人的输入”，ERROR 与独立 STDERR 合为“错误”，其余一一映射。消息气泡突出可读正文，技术字段、Digest、原始 metadata 按需展开。

桌面保持居中高密度审计弹窗，头部压成状态条 + metadata disclosure；窄屏使用接近全屏的单列布局、横向可滚动筛选和安全区底部。焦点回到来源按钮，Escape 由原生 dialog 关闭。
