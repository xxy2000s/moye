# Task Audit 画布仍重复展示状态且通用异常分区过大

> 文档类型：Finding
> 状态：Resolved by TASK-0053
> 发现日期：2026-08-25
> 影响范围：Task Audit、状态机 Graph、TaskWorkflow / SealedTaskWorkflow / CodingTaskWorkflow

## 观察

真实 `TASK-0051` 与 `TASK-0052` 详情页在“画布”Tab 上依次展示 Workflow 摘要卡、Runtime State Machine 标题说明、四格状态事实和 Graph。`CLOSED / ARCHIVED` 同时出现在页面 Header、摘要卡和四格事实中，正常任务打开后需要滚过大段重复信息才能看到画布。

同一页面仍命中通用 Graph 几何：`RECOVERY / EXCEPTION` 背景为 `1215×410`。TASK-0051 只压缩了 `CoreV2Workflow` 分支，未覆盖 `TaskWorkflow / SealedTaskWorkflow / CodingTaskWorkflow`，因此通用任务仍出现大块黄色空场。

## 影响

- 画布不再是默认 Tab 的第一视觉内容；
- 正常且一致的状态占用与异常同等的视觉层级；
- 用户容易把单执行者 Sealed Task 误解为经过多 Agent Core v2；
- 已完成的 Core v2 专用画布修复在最新项目任务上不可见，造成“修复没有生效”的正确观感。

## 边界

修复只重组浏览器内只读呈现和 Graph 几何，不改变 Runtime Definition、Event History、Projection、Workflow 状态、Agent Session 或归档结果。完整状态事实必须保留在“Workflow 状态事实”Tab；Event / Projection 不一致时仍需在画布主动提示。

后续工作进入 [BL-0064](../../delivery/backlog/BL-0064.yaml)。

## 处置

TASK-0053 删除三类画布中的重复 Workflow 摘要卡、常驻说明和四格正常状态；一致时只保留工具栏标识，不一致时才主动展开差异。四项完整事实进入 Workflow Tab。基础 Task 使用独立 `1640×380` 紧凑几何并移除不存在的 Recovery 背景，Coding 与 Core v2 使用各自紧凑异常节点簇。真实 `TASK-0052` 桌面与窄屏页面、真实 Core v2 Happy Task、静态契约和完整 E2E 均复验通过。
