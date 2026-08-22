# TASK-0025 Spec：状态机节点的完整执行下钻

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0026

## 目标

让 Graph 的每个节点成为真实审计入口。点击节点后，Inspector 必须把该状态对应的 Domain Event、Step Attempt、Agent/Role/Review Session、Verification、Git/Archive 或恢复判断聚合在一起，并允许直接打开该节点的 Chatbot Events。

## Requirements

### REQ-0025-01：节点事实总览

- 展示节点是否实际进入、进入/离开 Event 及时间；
- 展示所有关联执行实例的 kind、状态、Generation、Attempt/Run ID、开始结束和耗时；
- 展示 Evidence/Artifact 摘要，不用一行文本压缩全部事实。

### REQ-0025-02：Agent 与系统管控

- IMPLEMENT、CONTEXT、SELF_REVIEW、REVIEW、REPLAN、DOCS 节点关联相应 Agent/Role/Review；
- 展示 Runner、Session、Outcome/Verdict、Summary、Finding 数量；
- 有 Events URL 时直接打开现有 Chatbot Dialog；
- VERIFY 展示命令、退出码、耗时和绑定摘要；WORKSPACE、MERGE 展示 Git Effect/Commit；WAITING_RECONCILE 和失败节点展示恢复分类与动作。

### REQ-0025-03：真实性与可用性

- 只消费现有 Trace API，不补造缺失事实，不增加第二套状态机；
- 未执行节点明确显示“本次未进入”，仍保留合法边解释；
- Inspector 内部使用分组和渐进展开，桌面与移动端均可滚动；
- Events 弹窗关闭后焦点返回对应节点内的触发按钮。

## 非目标

- 不改变 Workflow、Projection、Domain Event 或 Artifact API；
- 不从页面推进、重试、回滚或 Reconcile Task；
- 不把所有原始 JSON 一次性塞进 Inspector；
- 不删除现有完整 Evidence 和高级诊断视图。
