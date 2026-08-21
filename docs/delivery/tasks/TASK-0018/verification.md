# TASK-0018 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0018 满足 Spec Revision 1。成功、预算终止和取消都从最终 Core Projection 推导唯一、不可变的 `CoreClosureResult`；keyed `CoreClosureWorkflow/<task_id>` 是唯一写入者，内容寻址 Scenario Artifact 在重放与 Worker 中断后只确认一次昂贵执行。真实 Restate 故障矩阵覆盖六条业务路径、Docs Gate 恢复、Observer 隔离、异步回执丢失和 `SIGKILL` 接管。

## Requirement 证据

- `REQ-0018-01`：Closure 前拒绝 Active Role 与 Pending Reconcile；成功绑定 Candidate/Review/Verification/Docs Impact，失败绑定预算终止候选，取消绑定原因、最后 Attempt、Artifact 与证据；三种结果都有 Closure Digest 和完整 Trace Index；
- `REQ-0018-02`：Closure Result 与 CLOSED Projection 深冻结并按内容寻址；相同 Artifact/status 重放得到同一 Digest，冲突取消证据拒绝；Observer 失败只记录 `observerError`，不改变 Core Outcome；
- `REQ-0018-03`：`CoreClosureWorkflow` 已注册并由 `TaskAuthority` 的 `CORE_WORKFLOW` owner 防止并行主 Workflow；Scenario Adapter 用稳定 Intent/Result 对账，`status` 只读返回 Projection；
- `REQ-0018-04`：真实 Restate 下 SUCCESS、REPAIR、REPLAN、UNKNOWN、BUDGET_EXHAUSTED、CANCELLED 全部收敛；Docs Gate 首次失败后通过，Observer 注入失败仍关闭；异步提交后两次 status 相同；Artifact rename 后 Worker 强杀重启，执行计数保持 1；
- `REQ-0018-05`：单测覆盖三种 Outcome、Trace 缺失、UNKNOWN 取消、冲突取消、场景矩阵、Artifact 重放与故障授权；全量检查和真实 Restate 回归通过。

## 自动化证据

- `npm run check`：通过；TypeScript、25 个单元测试文件共 145 项、文档图谱校验全部通过；
- `npm run test:e2e`：通过；5 个真实 Restate E2E 文件共 14 项；
- `npx vitest run tests/e2e/core-closure-workflow.test.ts`：通过；3 项覆盖六场景、异步回执和 Worker `SIGKILL`；
- `ruby scripts/docs_graph.rb validate`：通过；169 个文档节点、280 条关系、114 个 Markdown 文件；
- `git diff --check`：通过。

## 失败路径

- Trace 缺少 Projection 已有 Decision/Attempt/Finding/Verification/Docs Impact 引用：拒绝 Closure；
- Pending Reconcile 未决时取消或关闭：拒绝；同一取消重放幂等，不同证据冲突；
- Docs Impact Validator 首次失败：保持可恢复 Gate，第二次通过后才 Closure；
- Observer 抛错：只留下诊断错误，业务 Outcome 不变；
- Scenario 只存在 Intent 而无可验证 Result：返回 `UNKNOWN_SIDE_EFFECT`，不盲目重跑；
- 未开启 `MOYE_TEST_FAULT_INJECTION`：在创建 Intent/Artifact 前拒绝 fault；
- Artifact Root 或场景目录为符号链接、结果文件不是普通文件：拒绝读取或写入；
- Replan 跨 Spec Revision 延续 Attempt Generation，避免 Trace Attempt ID 碰撞；
- Worker 在结果 rename 后退出：新 Worker 读取相同 Artifact，`effectExecutionCount = 1`。

## 边界

- Scenario Adapter 使用确定性 Fake Role/Review/Verification/Docs 事实，只证明控制与恢复闭环，不证明真实多角色模型质量；
- Core Workflow 当前提供 Restate API/status，尚未接入 ProjectBoard UI、外层 Merge 或 Archive；这些状态与 Core Outcome 保持正交；
- 不包含多 Daemon Lease/Fencing、远程 PR/Merge、生产可观测平台或自动知识提升。
