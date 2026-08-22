# TASK-0025 Design

节点 Inspector 使用三层信息：顶部是状态和 Event 事实；中部按卡片列出关联 Execution；底部显示与节点类型匹配的系统事实。Agent/Role/Review 卡片提供 Session Chatbot 入口，Evidence 以可展开列表呈现。

`renderStateMachine` 和 `bindStateMachineGraph` 接收完整只读 Trace；节点和执行的关联只按稳定 `step`、`attemptId`、`runId` 与既有角色类型完成。`DOCS_GATE` 归入 `DOCS`，`ARCHIVE` 归入 `ARCHIVING`，其余不做模糊推断。
