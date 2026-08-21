# TASK-0013 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0013 满足 Spec Revision 1：`ControlDecision`、`CoreProjection`、确定性初始 Orchestrator 与唯一 Reducer 已形成内容寻址的纯领域控制内核。相同持久化输入可以重建相同候选；已确认 Decision 重放不增加 Projection Version、不重复 Role Dispatch、也不再次扣减预算。

## Requirement 证据

- `REQ-0013-01`：`createControlDecision` 规范化引用和预算字段，稳定生成 Decision ID/Digest；`parseControlDecision` 拒绝篡改内容与 Expected Digest 不一致；
- `REQ-0013-02`：`applyControlDecision` 先对账已确认 Decision，再校验 Task/Spec、Expected State/Version、预算、单 Pending Role 与初始 Docs Gate；
- `REQ-0013-03`：`proposeDeterministicControlDecision` 只读取已验证 TaskEnvelope 与 CoreProjection；序列化恢复后生成完全相同的 Decision；
- `REQ-0013-04`：新增 9 项单测覆盖合法、重放、过期、Task/Spec 冲突、Gate 跳过、Active Role、预算、篡改与不可信对象；原有单元和真实 Restate E2E 全部通过。

## 自动化证据

- `npx vitest run tests/unit/core-control.test.ts`：通过，1 个文件 9 项；
- `npm run check`：通过；TypeScript、18 个单元测试文件共 105 项及文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项通过，现有 Coding Workflow、未知结果对账和 Worker 恢复未回退；
- `ruby scripts/docs_graph.rb validate`：通过，137 个文档节点、230 条关系、93 个 Markdown；
- `git diff --check`：通过。

## 失败路径

- 过期 State 或 Projection Version：拒绝且原 Projection 保持 Version 1；
- Task/Spec 不匹配：拒绝；
- 初始阶段跳过 Docs 直接派发 Implementation 或 Close：拒绝；
- 已有 Pending Role 再派发：拒绝；
- Role/模型预算耗尽或把 Operation Retry 夹带进首次 Role 派发：拒绝；
- Decision/Projection 序列化内容被篡改：Expected Digest 校验失败；
- 未经协议创建的对象副本：WeakSet 信任边界拒绝。

## 边界

- 本 Task 只交付 Core Control 的纯领域切片，未声称 keyed Restate Core Workflow 或真实多 Role Runner 已完成；
- `RETRY/REPAIR/REPLAN`、Role 完成、Review Finding、Observer、Docs Impact Runtime Gate 和 CoreClosureResult 仍由后续 Slice 实现；
- 未引入新依赖、后台进程、容器或外部副作用。
