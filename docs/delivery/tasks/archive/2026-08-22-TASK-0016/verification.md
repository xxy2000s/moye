# TASK-0016 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0016 满足 Spec Revision 1：Operation Retry、Role Attempt Retry、Finding-driven Repair 和 Spec Replan 已成为同一 Core Reducer 中互不混淆的持久化控制事实。未知外部结果必须先等待并对账；中央预算按动作类别原子扣减；Required Gate 预算耗尽稳定收敛为一个 `FAILED_TERMINAL` Closure Candidate。

## Requirement 证据

- `REQ-0016-01`：Role Failure Record 固定 Dispatch、Attempt、Input/Result Digest 和错误分类；Role Retry 必须绑定最新 Failure，生成新 Dispatch/Generation N+1；Role Runner 要求完整连续历史，普通入口不能绕过失败事实；
- `REQ-0016-02`：Operation Retry 保留 Pending Dispatch 与 Generation，只扣 Operation Retry；`WAIT` 保存 Unknown Effect 并阻止恢复动作，`CONFIRMED | NOT_APPLIED` 带证据对账后才恢复 RUNNING；
- `REQ-0016-03`：Repair 只接受当前 Blocking Gate 的精确 Finding 集与 Gate Digest，保留 Gate 历史并派发 Implementation Generation N+1；Review Fail→Repair→Review Pass 到达 `VERIFICATION_REQUIRED`；
- `REQ-0016-04`：Replan 要求同 Task、Spec Revision N+1 的可信 Envelope，派发 Docs Generation 1，并显式登记旧 Envelope、Role Result、Gate 与 Finding 引用失效；
- `REQ-0016-05`：各动作预算形状固定且先校验后扣减；预算不足不部分应用；确定性 Orchestrator 产生内容寻址终态候选，相同 Decision/Failure/Reconcile 重放不推进版本；
- `REQ-0016-06`：新增 5 个恢复矩阵场景，并扩展 Core/Role 测试；全量单元、真实 Restate E2E 和文档门禁通过。

## 自动化证据

- `npm run typecheck && npx vitest run tests/unit/core-recovery.test.ts tests/unit/core-control.test.ts tests/unit/role-runner.test.ts tests/unit/review-finding.test.ts`：通过，4 个文件 26 项；
- `npm run check`：通过；TypeScript、21 个单元测试文件共 122 项及文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项；
- `ruby scripts/docs_graph.rb validate`：通过，157 个文档节点、260 条关系、106 个 Markdown 文件；
- `git diff --check`：通过。

## 失败路径

- 未记录 Role Failure、旧 Dispatch/Generation、非连续历史或成功 Attempt 试图 Retry：拒绝；
- Operation Retry 夹带 Role/Repair/Replan 预算，或 Role Retry 夹带 Operation Retry：固定预算形状拒绝；
- UNKNOWN 未对账时 Retry/Repair/Replan：状态 Gate 拒绝；相同 Reconcile 重放幂等，冲突结果拒绝；
- Repair Finding 集、Gate Evidence 或 Target 不精确：拒绝；Blocking Finding 未完成 Repair/Review Pass 不能进入 Verification；
- Replan 缺 Envelope、Task/Revision 不连续或 Evidence 未绑定新 Envelope：拒绝；旧证据只失效、不删除；
- Required Gate 预算耗尽只生成一个终态候选；预算尚可用的伪造 CLOSE 被拒绝。

## 边界

- 本 Task 只实现纯领域 Recovery Reducer；最终 `CoreClosureResult`、取消/失败 Archive 和 keyed Restate Core Workflow 属于后续 Slice；
- Reconcile 记录外部结果事实，但具体 Effect Adapter/账本仍由 Workflow 接入；
- 真实多角色模型 Repair/Replan、Verification 与 Observer 未在本 Task 实现。
