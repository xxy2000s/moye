# TASK-0063 Spec：Agent Session Chatbot UX

> 状态：Approved
> Spec Revision：1

- `REQ-0063-01`：Core v2 Session 弹窗默认消费 canonical `/timeline`，不得用 execution stream 或浏览器启发式分类冒充完整对话；旧 Workflow 保持 execution stream 兼容模式；
- `REQ-0063-02`：按 Prompt/User、Assistant、Tool Call、Tool Result、System、Error/stderr 精确筛选并显示计数；
- `REQ-0063-03`：消息展示 actor、origin、时间、tool name/call id、内容 disposition/digest；长内容可展开，digest-only/partial 不显示为空白成功；
- `REQ-0063-04`：弹窗头部展示 Provider、Provider Session、Capture Policy、COMPLETE/PARTIAL/PENDING/WAITING/UNAVAILABLE、完整性与父子 Session；
- `REQ-0063-05`：stderr 独立读取并明确标记 Runtime，不与 Provider Tool Result 合并；raw 只显示 metadata，不跳转下载；
- `REQ-0063-06`：加载、空、等待、错误和重试状态清晰；不可用时保留 execution stream 诊断入口但不降级称为完整 Session；
- `REQ-0063-07`：真实浏览器在桌面和窄屏验证弹窗、筛选、分页、长内容、键盘焦点、Escape/Close 与自动刷新。
