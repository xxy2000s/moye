# Findings：Bug、缺陷与异常发现

Finding 记录一个已经观察到、但尚未进入 Task 执行生命周期的问题。它可以来自开发、测试、Agent 运行或真实环境。

Finding 与 Incident 的边界：

- Finding 描述一个可独立确认和修复的问题；
- Incident 描述一次有时间线、影响和处置过程的故障事件；
- 一个 Incident 可以产生多个 Finding；
- 一个 Finding 经过去重和初步确认后可以生成 Backlog Item。

## 当前 Finding

- [Backlog 文档未投影到项目看板](./backlog-docs-not-projected.md)：Git 中的 Backlog YAML 与 Restate ProjectBoard Projection 尚无显式同步路径。
- [Demo 未展示编码任务与 Agent Trace](./demo-does-not-show-coding-agent-trace.md)：一键 Demo 仍使用通用 TaskWorkflow，无法体验已经实现的 Coding Trace。
- [CLI close 未按契约附着既有 Workflow](./cli-close-does-not-attach.md)：`create` 后调用 `close` 会重复调用 Workflow `run` 并收到 409，尽管同一 Workflow 已正常收束。
- [页面没有展示 Task 的真实状态机](./task-state-machine-not-visible.md)：静态阶段条和最终字段没有展示合法边、实际转换、Repair Attempt 与独立 Archive 历史。
- [多角色 Session Events 链接绕过弹窗](./session-events-links-bypass-viewer.md)：角色明细仍用新页面打开原始 Event API，绕过已有独立 Viewer 与分类筛选。
- [状态机节点下钻缺少执行与管控细节](./state-machine-node-details-shallow.md)：节点 Inspector 只显示计数和摘要，无法直接核对 Agent、Attempt、系统 Gate 与 Session Events。
- [节点 Agent Events 入口隐蔽且 Inspector 信息过密](./node-agent-events-hidden-and-inspector-dense.md)：真实 Agent Events 被埋在执行卡片底部，Domain Event 与 Agent Event 缺少清晰边界，节点详情难以扫描。

不要为了演示目录创建虚构 Bug。
