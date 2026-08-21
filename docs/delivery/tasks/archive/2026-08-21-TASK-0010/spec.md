# TASK-0010 Spec：在 Moye 看板内联查看 Agent Events

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0011

## 目标

把 Coding Task 详情中的 `Agent Events` 从浏览器文件下载入口改成 Moye 看板内的可读事件查看器，让用户不离开任务上下文即可观察 Agent CLI 的交互过程；原始 JSONL 仍保留为明确标注的次级下载入口。

## Requirements

### REQ-0010-01：默认内联查看

- `查看 Agent Events` 使用按钮语义，在当前 Task 详情内加载服务器已授权的 Artifact URL；
- 首次打开后显示事件数量、事件类型、摘要和可展开的原始 JSON；
- 再次点击可以折叠或展开已加载内容，不重复请求。

### REQ-0010-02：稳健且安全的事件呈现

- 提供加载中、空数据、HTTP/网络错误和单行 JSON 解析失败状态；
- Agent 事件中的文本和 JSON 必须转义后进入 DOM，不能引入脚本或任意 HTML；
- 限制一次渲染的事件数，超出时明确提示，避免大 Artifact 卡死页面。

### REQ-0010-03：原始证据与权威边界

- 原始 JSONL 继续由现有 allowlisted Artifact API 提供，不新增任意本地路径读取能力；
- 下载入口标注为 `下载原始 JSONL`，不再让用户误以为它是站内查看入口；
- 内联列表是诊断视图，不改变 Projection、Domain Event、Workflow Journal 或 Artifact 的权威性。

### REQ-0010-04：验收

- 单元或端到端测试覆盖内联查看器的关键 DOM 契约和 Artifact 响应；
- 真实浏览器验证成功加载、展开原始 JSON、键盘交互和窄屏布局；
- `npm run check`、`npm run test:e2e` 与文档影响门禁通过。

## 非目标

- 不修改 Agent Runtime JSONL 采集格式；
- 不实现 WebSocket 实时尾随、全文搜索、跨 Task 聚合或 Trace 后端替换；
- 不把 Raw Model IO 一并改造成内联查看；
- 不改变 Artifact 路径、摘要、大小和受管根校验。

## 完成定义

用户点击 `查看 Agent Events` 后，事件直接显示在当前 Coding Task 详情中，不触发默认下载；异常状态可理解、内容安全、原始文件仍可显式下载，并通过自动化与真实浏览器验收。
