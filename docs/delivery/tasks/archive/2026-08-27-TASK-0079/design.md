# TASK-0079 Design

> 状态：Approved

在现有 Project Board 静态应用内增加独立 `backlog-detail-dialog`。`backlogCard` 直接消费已经由 `/api/board` 返回并受 Digest 保护的 Projection，不回读 Git，也不发起详情写请求。卡片从静态 `div` 改为原生 `button`，详情层使用原生 `dialog.showModal()`、`close` 事件和触发按钮引用实现 Escape、焦点约束与焦点返回。

内容按“问题事实 → 范围与验收 → 来源与关联”三层组织。必需的 v2 problem 字段缺失时显示“未提供”，数组为空时显示明确空态；Source Digest 只在技术来源区显示。初始加载、fetch 错误、无 Backlog 使用同一 lane 内互斥状态，不把连接失败误报为需求为空。

CSS 保持现有编辑式视觉语言：卡片详情提示不展开长正文，Dialog 桌面为居中双列信息层，390px 为全宽单列且内容独立滚动。所有 UI 只派生 Projection，不改变 Workflow、ProjectBoard 或 URL 路由。
