# TASK-0048 Design

> 状态：Accepted

新增顶层 matrix orchestrator，由它创建唯一运行根并以显式子目录依次调用四个既有真实 suite。每个 suite 继续拥有自己的 Service/Workflow 控制与故障注入协议；orchestrator 不替换 Agent、Restate、Git、Trusted Runner 或 Effect，只负责冻结路径、收集确切 summary、构造 Audit Manifest、调用 TASK-0047 的 fail-closed 审计并保存统一报告。

所有 suite 支持调用方指定 run root，禁止根据目录扫描恢复或挑选结果。Recovery summary 增加 token/evidence/fault marker 的明确审计字段，统一审计 profile 验证这些字段与最终 Projection 的唯一副作用计数。

最终部署复用持久化 `moye-restate-live` 数据目录，注册当前 Result Commit 的 Moye Service，并让 Board 监听 3000；部署动作不迁移、不伪造或回写历史 Projection。
