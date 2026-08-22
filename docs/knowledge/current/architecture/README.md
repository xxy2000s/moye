# Architecture：当前有效设计

Architecture 文档描述系统当前有效的结构、边界、状态、协议和不变量。方案比较和选型证据放入 Research；重要取舍及其原因放入 ADR。

## 当前文档

- [总体架构](./overview.md)：完整 Harness 的系统上下文和领域划分。
- [Task Runtime Kernel 详细设计](./task-runtime-kernel.md)：Task 生命周期、恢复、交接、重试和对账。
- [Document Control Plane](./document-control-plane.md)：文档图谱、入口路由、影响传播和关闭门禁。
- [Restate PoC 架构](./poc-01-restate.md)：已经实现的第一轮垂直切片、恢复语义和验证边界。
- [Core v2 Agent Lifecycle](./core-v2-agent-lifecycle.md)：五类主流程 Agent、旁路 Observer/Knowledge、独立测试/审查与单 Result Commit Seal。

## 更新规则

- Architecture 表达“当前认为系统应该如何工作”；
- 已实现和未实现内容必须明确区分；
- 重大取舍先创建或更新 ADR；
- 只记录稳定边界，不记录临时实验日志；
- 模块路径变化同步更新 CodeMap；
- 与代码行为冲突时，在同一变更中明确修复代码或文档。
