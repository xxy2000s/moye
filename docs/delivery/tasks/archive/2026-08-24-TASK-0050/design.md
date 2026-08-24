# TASK-0050 Design

> 状态：Accepted

## 信息架构

Task Audit 继续采用全屏路由。首屏顺序固定为 Task 摘要、Closure/Failure 摘要、状态机事实、Graph。Graph 默认承担“本次发生了什么”，Inspector 承担“这个节点如何执行”，文本 Definition 承担“代码还允许什么”。三者不互相复制全部信息。

Inspector 使用稳定的事实层级：有 Session 的节点先显示 Agent Activity 和 Chatbot Events 主入口；随后显示 Workflow/Gate/Git/Archive 控制事实与本次状态流转；长 Attempt、Session、Artifact、Digest 收入 Evidence/Technical Details；合法路径最后按进入和离开分组，并把 traversed 边排在前面。没有 Session 的节点直接从系统控制事实开始，并明确“此节点由系统执行”。

## Graph 布局

Core v2 仍渲染完整 Definition，但画布分为紧凑的主流程带、异常/恢复带和 Archive 带。主流程使用稳定水平基线；Repair/Replan/Reconcile/Failure 只占一条紧凑辅助带；Archive 靠近 Merge/Closure。`ACTUAL` 与 `NORMAL` 视图隐藏无关边时同步降低无关节点强调，但不删除 DOM 中的合法 Definition。

适配缩放以当前可见路径和可用画布宽度计算，设置最小可读缩放。无法在窄屏保持节点文字可读时保留横向滚动，而不是继续缩小到不可读。

## Domain Event 与只读边界

Domain Event 的默认行只展示业务摘要。原始 detail 放入逐事件 disclosure，并继续使用转义文本，不解析或改写 Payload。Graph、Inspector、筛选和 Dialog 都只消费既有 API；无任何按钮可以调用 Workflow 状态推进命令。

## 视觉与响应式

沿用当前暖灰底色、单一蓝色交互强调和绿色实际路径语义。减少嵌套卡片，用间距、标题和单层分隔建立层级。桌面 Inspector 是右侧固定审计栏；小于 960px 时保持 Bottom Sheet，并让主要 Events 操作始终可见。动画仅用于 Inspector 开合与筛选反馈，并遵守 reduced motion。
