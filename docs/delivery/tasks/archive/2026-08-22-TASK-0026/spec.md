# TASK-0026 Spec：节点 Agent 活动优先的审计 Inspector

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0027

## 目标

让用户点击状态机节点后第一眼看到“这个节点有没有 Agent、Agent 做了什么、完整 Events 在哪里”，同时明确区分状态转换事实与 Agent Session 事件。

## Requirements

### REQ-0026-01：Agent 活动优先

- 有 Agent/Role/Review Session 的节点先展示 Agent 活动，而不是先展示 Domain Event；
- 显示角色、Runner、状态、Session、耗时、Verdict/Finding 和明确的“查看全部 Agent Events”主入口；
- 从现有 Events API 读取真实分类计数和最近事件预览，加载失败不影响节点其他事实。

### REQ-0026-02：事实类型解释

- 将 Domain Event 对用户解释为“状态流转记录”，说明它由 Workflow 写入并证明状态为何改变；
- 将 Agent Event 解释为某次 Session 内的对话、工具调用、工具结果、系统和错误记录；
- 两类 Event 在文案、布局和视觉上明确分区，不互相冒充。

### REQ-0026-03：视觉与交互

- Inspector 使用扁平分区和稳定层级，减少嵌套边框、编号圆点和重复标签；
- 首屏保留主要结论与 Agent Events，不用滚过 ID 表格才能找到动作；
- 长 ID 与 Evidence 默认降级为可展开技术详情；
- 桌面 Inspector、移动 Bottom Sheet、键盘焦点和 Chatbot Dialog 回焦保持可用。

## 非目标

- 不改变 Workflow、Projection、Domain Event 或 Events API；
- 不把 Agent JSONL 写入 Runtime 状态；
- 不用 Mock/Fake Event 填充预览；
- 不在 Inspector 中一次渲染完整 Session。
