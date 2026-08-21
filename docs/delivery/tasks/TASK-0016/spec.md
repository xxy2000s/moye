# TASK-0016 Spec：Retry、Repair、Replan 与中央预算

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0003
> 母需求：CORE-REQ-04 / Slice 4

## 目标

在同一个 Core Task 中把底层 Operation Retry、Role Attempt Retry、Finding-driven Repair 和 Spec Replan 建模为不同的持久化控制事实，并统一扣减中央预算。所有动作仍由 Workflow Reducer 校验；未知外部结果先等待和对账；预算耗尽只产生一个失败终态候选，不形成无限嵌套循环。

## Requirements

### REQ-0016-01：Role Attempt 失败与 Retry

- 明确失败的 Role Attempt 形成内容寻址 Failure Record，终结旧 Attempt；
- `RETRY + targetRole` 只在最近失败与 Pending Dispatch 一致时创建新 Dispatch/Generation N+1；
- Role Runner Retry 要求完整连续历史和新 Pending Generation，不复活旧 Attempt；
- Role Attempt Retry 扣减 Role Attempt/Model Call 预算，不扣 Operation Retry。

### REQ-0016-02：Operation Retry 与 UNKNOWN

- `RETRY + targetRole:null` 表示 Operation Retry，不创建 Role Attempt、不改变 Pending Dispatch Generation；
- Operation Retry 只扣减 Operation Retry 预算；
- `WAIT` 记录 UNKNOWN Effect 并进入 `WAITING_RECONCILE`，不得调度新 Role；
- Reconcile 明确 `CONFIRMED | NOT_APPLIED` 后才能回到 RUNNING；未知状态下 Retry/Repair/Replan 拒绝。

### REQ-0016-03：Finding-driven Repair

- `REPAIR` 只从 `REPAIR_REQUIRED` 进入，Target 固定 Implementation；
- Source Finding 必须精确覆盖当前 Review Gate 的 Blocking Finding；
- Repair 保留 Review Gate 历史，清空当前 Gate 并派发 Implementation Generation N+1；
- Repair 同时扣减 Repair、Role Attempt 和 Model Call 预算。

### REQ-0016-04：Replan 与 Evidence 失效

- `REPLAN` 必须提供同一 Task、Spec Revision N+1 的新 TaskEnvelope，并由 Decision Evidence 绑定其 Digest；
- Replan 固定 Target Docs，派发新 Spec 的 Docs Generation 1；
- 旧 Envelope、Role Result、Review Gate 与 Finding 引用形成显式 Evidence Invalidation，历史不删除；
- Replan 扣减 Replan、Role Attempt 和 Model Call 预算。

### REQ-0016-05：中央预算与终止候选

- 每类 Decision 的 Budget Request 形状固定，不能夹带另一类 Retry/Repair；
- 预算不足时该动作不得部分应用；
- 确定性 Orchestrator 在 Required Gate 无可用预算时只产生一个 `FAILED_TERMINAL` Closure Candidate；
- 相同 Failure、Decision、Reconcile 和 Terminal Candidate 重放幂等。

### REQ-0016-06：验证

- 测试覆盖 Operation Retry 不增 Attempt、Role Retry N+1、Review Fail→Repair→Review Pass、Design Fail→Replan、UNKNOWN/Reconcile、预算不足/耗尽与重复投递；
- `npm run check`、真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 本 Task 不生成最终 CoreClosureResult，也不实现取消/失败 Archive；
- 不引入多 Daemon Lease、Heartbeat 或 Fencing；
- 不执行真实模型 Repair/Replan，只验证确定性协议和 Reducer 路径。

## 完成定义

四类恢复动作具有独立字段、预算和状态效果；Role Retry 使用新 Generation；Repair 绑定 Blocking Finding；Replan 绑定新 Spec 并使旧证据失效；UNKNOWN 不盲重试；预算耗尽稳定收敛到一个终止候选。
