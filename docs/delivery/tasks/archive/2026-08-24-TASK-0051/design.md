# TASK-0051 Design

> 状态：Accepted

## 画布结构

主流程继续保持单行。Replan 保留在 Design Review 上方，Repair、Reconcile 与 Failed 收敛到主流程下方的一条紧凑异常支线。Archive Pending、Closed、Archived 与 Archive Failed 保持独立归档分区。

Recovery 背景由横跨画布的固定泳道改为节点簇容器：容器只包围异常支线，并用细边界与轻量底色表达领域，不用大面积黄色填充表达未发生流程。Archive 容器同理跟随归档节点簇。

## 只读边界

节点、边、History 和 Inspector 数据来源不变；调整只发生在浏览器内的 `viewBox`、节点坐标与装饰性 lane geometry，不修改状态机 Definition 或 Runtime Projection。

## 响应式

桌面适配视图优先读清主流程与紧凑支线；窄屏保留当前横向画布审计，不继续缩小节点文字。分区容器不得扩展页面自身宽度。
