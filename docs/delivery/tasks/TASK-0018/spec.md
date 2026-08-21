# TASK-0018 Spec：Core ClosureResult 与真实 Restate 故障矩阵

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0018
> 母需求：CORE-REQ-07 / CORE-REQ-08 / Slice 6

## 目标

把前五个 Slice 的纯领域协议接入唯一 keyed `CoreClosureWorkflow/<task_id>`，让成功、预算终止和取消生成不可变、内容寻址的 `CoreClosureResult`。用真实 Restate 场景证明 Decision、Role Run、Repair、Replan、UNKNOWN、Observer、Docs Gate、关闭回执丢失和 Worker 重启最终唯一收敛。

## Requirements

### REQ-0018-01：统一 ClosureResult

- 支持 `SUCCEEDED | FAILED_TERMINAL | CANCELLED`；
- Closure 前 Active Attempt 为零、无 Pending Reconcile，Required Gate 均有明确结论；
- 成功绑定 Candidate Commit、Review Passed、Verification 和 Passed Docs Impact；
- 失败绑定分类、最后 Attempt、Finding 与保留 Artifact；取消绑定原因、最后 Attempt 和已产生 Artifact；
- Result 固定完整 Trace Index 与 Closure Digest，可序列化恢复。

### REQ-0018-02：唯一关闭

- 相同 keyed Workflow 重放/重复 Close 返回同一 Closure Digest；
- 不同 Outcome 或证据不能覆盖已确认 Result；
- Observer、Board、Archive、外围 Merge 失败不改写 Core Outcome；
- CLOSED 后不再调度 Role 或消耗预算。

### REQ-0018-03：Keyed Core Workflow

- 注册 `CoreClosureWorkflow`，Workflow 是 Core Projection 唯一写入者；
- Scenario Adapter 用内容寻址 Artifact/Intent 对账已确认执行，未知结果不重复昂贵操作；
- `status` 只读返回业务 Projection，可由 `task_id` 定位全部事实；
- TaskAuthority 阻止同 Task/Revision 被其他主 Workflow 同时认领。

### REQ-0018-04：真实 Restate 故障矩阵

- 成功、Repair、Replan、UNKNOWN→Reconcile、预算耗尽、取消均在真实 Restate 收敛；
- Docs Impact 首次失败可恢复，不伪装 CLOSED；Observer 失败不阻塞主流程；
- Worker 在场景 Artifact 持久化后退出，重启不重复执行且 Closure Digest 唯一；
- 异步提交造成关闭回执丢失后，状态查询/重放返回同一结果。

### REQ-0018-05：验证

- 单测覆盖三种 Gate、缺失证据、冲突关闭、CLOSED 后派发拒绝和场景协议；
- `npm run check`、扩展后的真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 不实现远程 PR/Merge、多 Daemon Lease/Fencing 或生产运营平台；
- Scenario Adapter 用确定性 Fake Role/Docs/Verification 事实验收控制闭环，不声称真实模型质量；
- Core Outcome 与外层 Archive/Board 状态保持正交。

## 完成定义

六个 Slice 形成可执行 keyed Core Workflow；三种结果各自唯一；最小故障矩阵可重复执行并证明已确认昂贵操作不重复、未知先对账、关闭与外围状态解耦。
