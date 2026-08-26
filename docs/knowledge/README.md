# Knowledge：项目长期知识

Knowledge 保存跨 Task 持续有效的项目知识，按照其权威角色分为：

- `decisions/adr/`：已经接受的重要取舍和历史；
- `current/architecture/`：当前系统设计、边界和不变量；
- `current/codemap/`：当前实现结构和依赖导航；
- `guidance/pitfalls/`：可复用风险和反模式；
- `guidance/runbooks/`：经过验证的操作步骤。
- `guidance/releases/`：按版本冻结的发布说明、兼容范围、证据与已知限制。

Task 可以读取这些知识，也可以通过 Docs Impact 产生更新义务。知识更新必须遵守各类型的审核规则，不能由单次 Agent 输出自动提升为 Accepted ADR 或当前 Architecture。
