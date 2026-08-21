# TASK-0013 Spec：Core ControlDecision 与确定性控制内核

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0014
> 母需求：CORE-REQ-01 / Slice 1

## 目标

建立不依赖 Agent 进程内存的 Core 控制领域模型：Orchestrator 只根据持久化 TaskEnvelope 和 Projection 提出候选 `ControlDecision`，由确定性 Reducer 校验并推进控制状态。该切片为后续 keyed `CoreClosureWorkflow`、Role Attempt 和 Repair/Replan Loop 提供唯一合法转换内核。

## Requirements

### REQ-0013-01：稳定 ControlDecision

- Decision 固定 Task、Spec Revision、Expected State、Projection Version、Action、Target Role、Finding/Evidence 引用、预算申请、原因和 SHA-256 Digest；
- Decision ID 与 Digest 由规范化内容派生，不能依赖时间、聊天历史或对象遍历偶然顺序；
- 序列化恢复必须由 Expected Digest 校验，篡改字段后拒绝。

### REQ-0013-02：唯一状态推进边界

- 只有 `applyControlDecision` 可以根据候选 Decision 产生下一版 Core Projection；
- 过期 State、版本不匹配、Task/Spec 不匹配、非法 Target Role、跳过 Required Gate 和预算不足均不得推进；
- 任意时刻最多一个待执行 Role，存在 Active/Pending Role 时拒绝再次派发；
- 已确认的相同 Decision 重放返回原 Projection，不产生第二次 Role Dispatch；相同 ID 不同 Digest 作为冲突拒绝。

### REQ-0013-03：可恢复 Deterministic Orchestrator

- Fake Orchestrator 的输入仅为 TaskEnvelope、Core Projection、Finding/Artifact 引用和预算；
- 相同持久化输入在 Orchestrator 重启后生成相同 Decision ID 与 Digest；
- 初始 Core 状态只能调度 Docs Role，不能越过 Spec/Plan/Design Gate 直接调度 Implementation、Review 或 Close。

### REQ-0013-04：验证与演进边界

- 单测覆盖合法调度、相同重放、冲突重复、过期版本、非法跳转、Active Role、预算不足和重启确定性；
- 当前 Coding Workflow 行为不回退；
- 架构与 CodeMap 明确本切片是 Core Workflow 的纯领域控制内核，Role Runner、Finding、Repair/Replan、Observer、Docs Gate 和 Closure 由后续 Task 接入。

## 非目标

- 本 Task 不调用真实模型，不实现 Docs/Implementation/Review Runner；
- 不提前实现 Finding 生命周期、Repair/Replan 预算消费、Observer 或 CoreClosureResult；
- 不替换现有 `CodingTaskWorkflow`，也不引入多 Daemon、Lease、Fencing、远程 SCM 或并发可写 Workspace。

## 完成定义

ControlDecision 与 Core Projection 能由规范化持久事实重建；Reducer 对合法与非法决策给出确定结果，相同已确认决策重放不重复生成 Role Dispatch；相关单测、全量检查和文档门禁通过。
