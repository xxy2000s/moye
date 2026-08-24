# Core v2 Recovery / Exception 分区仍占据大块空白

> 文档类型：Finding
> 状态：Resolved by TASK-0051
> 发现日期：2026-08-24
> 影响范围：Core v2 Task Audit、状态机 Graph 画布

## 观察

TASK-0050 将 Core v2 画布高度从 760 压缩到 590，并重新定位异常节点，但真实页面仍固定绘制 `x=18, y=300, width=1205, height=270` 的黄色 `RECOVERY / EXCEPTION` 背景。Repair、Reconcile 与 Failed 只占这个区域的一小部分，剩余空间仍形成显著黄色空场。

## 影响

- 用户仍会把未发生的异常区域理解为画布主体；
- 默认实际路径视图虽然隐藏异常边，却没有同步收紧异常分区的视觉占用；
- “画布已压缩”的文档结论超过了真实视觉证据。

## 边界

修复只调整只读 Graph 的节点坐标、画布尺寸与分区背景，不改变 Runtime Definition、合法边、实际 History、状态语义或任何 Workflow 状态。

后续工作进入 [BL-0062](../../delivery/backlog/BL-0062.yaml)。

## 处置

TASK-0051 将 Core v2 画布高度从 590 收到 485，把 Repair、Reconcile 与 Failed 收敛到同一条异常支线，并把 Recovery / Exception 背景从 `1205×270` 改为只包围节点簇的 `575×145`。真实 Happy Task 在默认实际路径、完整 52 边、1440px 桌面和 390px 窄屏下复验通过；Runtime Definition、History 和 Projection 均未修改。
