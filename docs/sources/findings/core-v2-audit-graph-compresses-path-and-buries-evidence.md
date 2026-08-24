# Core v2 审计画布压缩主流程且节点证据层级不清

> 文档类型：Finding
> 状态：Resolved by TASK-0050
> 发现日期：2026-08-24
> 影响范围：Core v2 Task Audit、状态机 Graph、节点 Inspector、Domain Event

## 观察

在真实归档任务 `TASK-ACCEPT-20260823175744-01-HAPPY` 的全屏审计页中，Graph 的“适配”视图同时容纳 19 个状态和 52 条合法转换。主流程节点被压缩到页面下方的窄条，Recovery/Exception 区域保留了大块空白，未发生的异常边仍主导整体占用。

点击主流程节点后，Trace 已经提供 Role、Attempt、Session、Agent Event、Workflow Event、Verification、Git 和 Artifact 事实，但 Inspector 仍需要在多个同权重区块与折叠层之间寻找。完整 Domain Event 展开后把 detail 直接作为代码块展示，合法进入/离开路径也没有先突出本次实际经过的边。

## 影响

- 用户不能在适配视图中先读清本次真实主路径；
- Recovery 与异常分支的画布占用和本次发生概率不匹配；
- “Agent 做了什么”“系统如何管控”“状态为何流转”缺少稳定的信息优先级；
- 原始 detail、长 ID 和合法但未发生路径干扰业务事实扫读；
- 桌面侧栏与移动 Bottom Sheet 都需要重复展开才能完成一次节点审计。

## 边界

修复只消费现有只读 Trace、Definition、History、Execution 与 Events API。不得修改 Workflow、Projection、Domain Event、Runtime 状态或合法边集合，也不得根据 Artifact 或页面推断不存在的执行。

后续工作进入 [BL-0061](../../delivery/backlog/BL-0061.yaml)。

## 处置

TASK-0050 将默认 Graph 改为本次实际路径，压缩 Core v2 泳道并补齐 Archive 节点稳定位置；Inspector 现在按 Agent、系统管控、状态流转、本次路径和技术详情分层，无 Session 节点显示系统所有权。Domain Event 原始 detail 与完整合法转换改为按需展开。修复使用真实归档任务完成桌面、窄屏和 Agent Events 弹窗验收，不改写 Runtime Projection 或 Event History。
