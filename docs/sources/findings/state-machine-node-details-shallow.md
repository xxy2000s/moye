# 状态机节点下钻缺少执行与管控细节

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-22  
> 影响范围：Task Graph、节点 Inspector、Agent Events、系统审计

## 观察

在真实 Coding Task `TASK-LIVE-ROLE-STREAM-2-20260822` 中点击 `IMPLEMENT` 节点，Inspector 只展示入边、出边、Event 数量、执行实例数量及一行 Evidence 摘要。Trace API 实际已经返回 Step Attempt、Agent Run、Session、时间、Evidence Digest、Role/Review、Verification、Git 和恢复判断，但 Inspector 没有呈现这些事实，也没有打开该节点对应 Session Events 的入口。

## 影响

- 用户无法从 Graph 节点理解 Agent 实际做了什么；
- Attempt、Generation、耗时、Runner、Session 和 Evidence 需要到折叠长页中重新查找；
- Context、Review、Docs Gate 等系统管控角色无法在对应节点直接核对；
- Graph 虽然可点击，但没有形成“状态 → 执行 → 对话/工具 → 证据”的审计闭环。

## 边界

修复应只消费现有只读 Trace，不新增 Runtime 状态或推断不存在的执行。未执行节点继续只展示合法边和“未进入”事实。

后续工作进入 [BL-0026](../../delivery/backlog/BL-0026.yaml)。
