# 单任务弹窗与原始 Domain Event 难以持续审计

> 文档类型：Finding
> 状态：Resolved by TASK-0028
> 发现日期：2026-08-22
> 影响范围：Task Audit、浏览器导航、Domain Event

## 观察

真实任务详情仍由覆盖项目看板的 `<dialog>` 承载。任务没有独立 URL，刷新、分享直达和浏览器 Back/Forward 都不能表达“当前正在审计哪个 Task”；右上角“关闭”也没有明确返回项目总览的导航语义。

详情底部“原始 Domain Event”展开后直接复用通用四列列表。事件类型、状态转换、时间和 detail 的阅读顺序不稳定，长 detail 与窄屏布局尤其难扫读。

## 影响

- 单任务审计仍像临时浮层，不像可持续跟踪的主工作区；
- 浏览器地址无法作为 Task 审计入口，刷新和历史导航不可预测；
- 原始业务 Event 与普通列表混在一起，用户难以沿 sequence 复核实际状态转换；
- Agent Events 已有专用 Chatbot Viewer，但 Domain Event 没有与其职责清楚区分的展示结构。

## 边界

修复只改变只读 Board 的路由与展示，不改变 Workflow、Projection、Definition、History 或任何 Task 状态。Domain Event 继续来自 Runtime Trace，不补造或扫描 Task Artifact 推断事件。

后续工作进入 [BL-0029](../../delivery/backlog/BL-0029.yaml)。

## Resolution

TASK-0028 将任务详情改为可直达、可刷新的全屏路由，并把完整 Domain Event 改为按 sequence 阅读的纵向时间线；真实桌面与移动浏览器验收通过。
