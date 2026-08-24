# TASK-0053 Spec：收敛 Task Audit 重复摘要与通用画布空白

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0064](../../../backlog/BL-0064.yaml)

- `REQ-0053-01`：三类 Task Trace 的“画布”Tab 必须直接以 Graph 为主体，不再重复渲染 Workflow 摘要卡、常驻说明文字和四格正常状态；
- `REQ-0053-02`：Event / Projection 一致时只显示一个紧凑一致性标识；不一致时必须在 Graph 前显示业务状态、Archive 状态、整体落点与 Event 重建的差异；
- `REQ-0053-03`：四项完整状态事实必须保留在“Workflow 状态事实”Tab，并与 Domain Event 时间线共同呈现；
- `REQ-0053-04`：TaskWorkflow、SealedTaskWorkflow 与 CodingTaskWorkflow 必须使用各自的紧凑 Graph 几何，Recovery / Exception 背景只包围对应异常节点，不保留大块黄色空场；
- `REQ-0053-05`：基础 Task Trace 必须明确显示没有 Agent Session，并展示真实 Workflow kind，不能暗示已经经过 Core v2 多 Agent 流程；
- `REQ-0053-06`：变更必须通过静态契约测试、真实 Runtime 桌面与窄屏浏览器验收、`npm run check`、`npm run test:e2e`、Docs Impact Gate 和唯一 Sealed Result Commit。
