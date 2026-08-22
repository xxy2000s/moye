# 节点 Agent Events 入口隐蔽且 Inspector 信息过密

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-22
> 影响范围：Task Graph、节点 Inspector、Agent Events、信息层级

## 观察

在真实 Coding Task `TASK-LIVE-ROLE-STREAM-2-20260822` 中点击 `IMPLEMENT` 节点后，关联 Agent Session 和 Events 确实存在，但 Events 入口位于第二层执行卡片底部，首屏不可见。Inspector 同时叠加章节编号、计数徽标、事件卡、执行卡、事实表和多层边框，用户难以先回答“这个 Agent 做了什么”。

“实际状态事件”又直接使用 Domain Event 术语，没有解释它与 Agent 对话、工具调用的区别，造成用户把两类 Event 混为一谈。

## 影响

- 节点虽已关联 Agent Run，但用户无法立即定位该 Run 的真实事件流；
- 关键动作被 ID、摘要和 Evidence 视觉淹没；
- Domain Event 与 Agent Event 的来源、用途和粒度不清楚；
- 移动端与窄侧栏中的多层卡片显得拥挤且难以扫描。

## 边界

修复继续消费现有 Trace 和受控 Events API。Domain Event 仍是状态转换事实，Agent Event 仍是 Session 中的对话、工具、系统和错误记录；两者不能合并成同一事实类型。

后续工作进入 [BL-0027](../../delivery/backlog/BL-0027.yaml)。
