# TASK-0066 Design

> 状态：Approved

## 设计

新增 Accepted ADR 作为 M2 所有公共契约和发布工作的唯一长期决策来源；当前 Architecture 只描述决策落地后的有效边界，Milestone 保留工作包和验收顺序。

公共消费者只接触版本化 Project Manifest、Core Schema、Client/CLI 和 Plugin SDK。Restate handler、Projection、Artifact 本机路径、内部 reconcile token 与 Workflow Input 保持私有；Client 只提交消费级请求和读取事实，Workflow 继续独占 Task 主状态。

版本采用统一产品版本 `0.1.0`，公共包、容器、Git Tag 与 Release Manifest 使用同一 Release Identity。Schema 与 Plugin API 使用独立整数协议版本，以显式 capability negotiation 和至少一个 minor release 的兼容窗口处理演进；破坏性变化必须迁移或明确拒绝。

发布 Effect 必须先持久化包含版本、Git SHA、产物摘要和目标渠道的 Intent，再查询目标端确认；回执未知时不得重新发布不同字节。
