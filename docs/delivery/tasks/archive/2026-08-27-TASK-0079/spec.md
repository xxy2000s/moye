# TASK-0079 Spec

> 状态：Approved
> Milestone：[M3 Backlog 与 Session Clarity](../../../milestones/m3-backlog-and-session-clarity.md)

## 目标

让 canonical Project Board 的 Backlog 卡片保持紧凑，并提供可访问的按需详情层，完整呈现 Backlog v2 Projection 中的问题、Evidence、验收方向、来源和关联 Task。

## Requirements

- `REQ-0079-01`：Backlog 卡片为可聚焦按钮，只显示 ID、优先级、标题、状态、类型和明确详情提示；长问题正文不进入卡片，也不拉伸卡片高度。
- `REQ-0079-02`：详情层按 `observed / expected / impact` 层级展示问题，另列 Evidence、affected areas、acceptance outline、canonical source path/digest 与 task refs。
- `REQ-0079-03`：v1/缺省可选字段显示可辨认的空值，不补造事实；Board 初始加载、请求错误和无 Backlog 分别有独立状态。
- `REQ-0079-04`：原生 Dialog 支持 Escape 关闭，关闭后焦点返回触发卡片；详情层与现有 Agent Events Dialog 不共享状态。
- `REQ-0079-05`：真实 canonical Board 在 1440px 与 390px 通过布局、滚动、键盘路径和内容完整性验收，保存截图与浏览器证据。
- `REQ-0079-06`：Board 继续只读，不新增 Runtime 写入口或本地持久化事实。

## 非目标

- 不修改 Backlog Schema、同步结果或 Projection。
- 不修改 Task Audit 页面和 Session 语义。
