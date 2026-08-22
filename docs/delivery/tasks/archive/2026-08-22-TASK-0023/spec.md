# TASK-0023 Spec：实际路径点亮的完整状态机 Graph

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0024

## 目标

任务详情默认展示一张由 Runtime Trace `definition + history + executions` 直接驱动的状态机 Graph 画布。画布一次性建立正常流程、修复/回滚、规格修订、未知副作用对账、失败终态与独立归档的空间关系；实际 Event 经过的节点和边随 Projection 刷新点亮。

## Requirements

### REQ-0023-01：完整定义画布

- 每个 `definition.nodes` 节点都在画布中出现，不手写另一份状态集合；
- 每个 `definition.edges` 合法转换都可在画布或当前筛选视图中查看；
- NORMAL、REPAIR、FAILURE、ARCHIVE 使用文字图例、线型和颜色共同区分；
- Business、Recovery/Exception 和 Archive 形成清楚的空间分区。

### REQ-0023-02：实际路径实时点亮

- `node.status = VISITED/CURRENT` 和 `edge.traversed` 直接控制点亮状态；
- 当前状态具有独立标识，实际边显示 Event 已证实语义，未经过边保持低对比；
- Task Detail 的既有五秒刷新继续驱动画布更新，不创建新的状态源；
- Projection 与 Event History 不一致时继续显示显式告警。

### REQ-0023-03：探索与证据下钻

- 顶部支持“全部、实际路径、主流程、恢复/回滚、失败、归档”视图筛选；
- 提供放大、缩小、适配画布，不依赖拖拽才能操作；
- 节点可点击和键盘激活，侧边详情列出状态、入边、出边、实际 Event、Attempt/Session/Evidence 数量；
- 实际 History、执行实例和完整合法边列表继续作为文本事实来源。

### REQ-0023-04：可访问性与响应式

- 图形提供可访问标题/说明，节点使用真实按钮或等价键盘语义与可见焦点；
- 点亮不只依赖颜色，实际边使用更粗实线，异常/归档使用不同虚线；
- `prefers-reduced-motion` 下禁用路径脉冲；
- 窄屏允许受控的画布横向浏览，工具栏可换行，详情仍可读；
- 自动化和真实浏览器验证正常闭环及失败/回滚分支的呈现契约。

## 非目标

- 不改变 Workflow、Event、Projection、Attempt 或 Archive 状态语义；
- 不让用户从画布推进、回滚或重试 Task；
- 不引入 React Flow、D3、Cytoscape 或其他前端依赖；
- 不伪造未发生的转换、Attempt 或 Session；
- 不实现任意拖拽编辑状态机。

## 完成定义

真实 Coding Task 的全部合法状态与异常路径可以在一个 Graph 画布中探索；实际运行路径被 Event History 点亮，节点可下钻证据，文本 History/Definition 仍完整可访问，桌面与窄屏验证通过。
