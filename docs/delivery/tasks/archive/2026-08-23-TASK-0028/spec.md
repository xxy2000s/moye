# TASK-0028 Spec：全屏任务审计、Domain Event 时间线与本地 Runtime 持久化

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0029、BL-0030

## 目标

让一个 Task 成为可直达、可刷新、可用浏览器历史导航的全屏审计页面；同时把完整 Domain Event 改成可逐条核对的业务事件时间线，并确保标准本地 Restate 启动不会因容器重建丢失新运行投影。

## Requirements

### REQ-0028-01：全屏任务路由

- 项目总览使用 `/`，单任务详情使用 `/tasks/<task_id>`；
- 点击 Task 卡片通过浏览器 History 进入全屏页面，不再打开 Task Detail Dialog；
- 右上角提供“返回项目”，浏览器 Back/Forward 正常工作；
- 直接打开或刷新任务 URL 时，服务器返回应用入口并由页面加载对应真实 Trace；
- 返回总览时恢复此前滚动位置，不创建或推进任何 Runtime 状态。

### REQ-0028-02：Domain Event 时间线

- 展开区明确说明 Domain Event 是 Workflow 业务事实，不是 Agent 对话或工具输出；
- 每条 Event 按 sequence、`from → to`、event type、时间和 detail 的稳定顺序展示；
- 长 detail 使用有边界、可换行的技术下钻区域，空 detail 不补造内容；
- 通用 Task 与 Coding Task 使用同一展示语法，窄屏无横向溢出。

### REQ-0028-03：本地 Runtime 持久化

- 标准 Compose 提供 Restate 1.7.4 服务和持久化 `/restate-data` 的命名卷；
- `runtime:up`、`runtime:status`、`runtime:down` 可重复执行，默认停止不删除数据卷；
- Runbook 明确 Git Task Archive、ProjectBoard Projection 与 Workflow Journal 的权威边界及旧数据限制；
- 当前页面仍只展示 Runtime Projection，不扫描 Git Archive 伪造 History。

### REQ-0028-04：回归与真实验收

- 节点 Inspector、Agent Events Chatbot Dialog、筛选、Esc 与回焦保持可用；
- 自动化覆盖静态路由回退及新的页面结构；
- 真实持久化 Runtime 上验证任务直达、刷新、Back/Forward、Domain Event 展开和响应式布局；
- 不使用 Mock/Fake 数据冒充用户实际页面结果。

## 非目标

- 不从 Git Artifact 自动重建已经丢失的 Workflow Journal 或 ProjectBoard Projection；
- 不改变 Task Workflow、状态机 Definition/History 或事件内容；
- 不新增页面状态写入口；
- 不把 Restate 定为最终生产选型。
