# TASK-0078 Spec

> 状态：Approved
> Milestone：[M3 Backlog 与 Session Clarity](../../../milestones/m3-backlog-and-session-clarity.md)

## 目标

只为当前开放的 BL-0004、BL-0005、BL-0006、BL-0007 与 BL-0083 补录 Backlog v2 问题事实，部署 TASK-0077 兼容 Service 后通过正式文档同步把 BL-0083 纳入 canonical Board，并让 BL-0031 按既有 Git `converted_to_task` 事实合法收敛。

## Requirements

- `REQ-0078-01`：五个指定开放条目升级 v2，问题陈述只引用仓库/Runtime 已有事实；其他历史 Backlog 保持原字节不变。
- `REQ-0078-02`：BL-0006/0007 明确区分已消费 Core 子集与仍开放生产能力，不把部分完成误报为全部完成或完全未做。
- `REQ-0078-03`：在 canonical `50889/50890` 部署包含 v2 合同的 Service，再执行一次正式 `backlog sync`；保存 batchId、源摘要、前后 Board 与 Sync Result。
- `REQ-0078-03A`：正式 CLI 支持显式、严格的文档 ID 子集；本次批次只含 BL-0004/0005/0006/0007/0031/0083，缺失、重复或非法 ID 在 Runtime 前拒绝。
- `REQ-0078-04`：同步后开放列表包含 BL-0004/0005/0006/0007/0083，BL-0031 不再显示；不得直接修改 ProjectBoard Projection。
- `REQ-0078-05`：相同文档批次第二次正式同步返回全部 `unchanged`，没有新 batch 或其他副作用。
- `REQ-0078-06`：通过文档解析、真实 Runtime/Board 对账、Docs Impact、唯一 Result Commit、Seal 与 Archive。

## 非目标

- 不迁移 completed/converted 历史 Backlog；BL-0031 保持 schema v1。
- 不实现 Backlog 详情页面、Session 语义或外部项目脚手架。
