# TASK-0014 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0014 满足 Spec Revision 1：Docs、Implementation 与 Review 已共享同一 Role Attempt、Request、Result 和 Artifact Manifest 协议。Role Attempt 只能从 Core Projection 的唯一 Pending Dispatch 创建；成功 Result 经身份与 Digest 校验后，Projection 依次推进至下一 Required Gate。完整 Manifest 可由新 Runner 恢复且不会再次计数，只有 Execution Intent 的未知结果会停止并要求对账。

## Requirement 证据

- `REQ-0014-01`：`createRoleRunRequest` 固定 Task、Spec、Role Step、Attempt/Generation、Dispatch/Input Digest、Runner、物理 Scope、Prompt Digest 与稳定 Run ID；`parseRoleRunRequest` 以 Expected Run ID 拒绝身份篡改；
- `REQ-0014-02`：Role Attempt 单向推进，终态不复活，成功后禁止 Retry；失败后只接受连续完整历史并创建 Generation N+1；`completeRoleDispatch` 校验唯一 Pending Dispatch，成功完成重放幂等、冲突结果拒绝；
- `REQ-0014-03`：Docs 两类输出、Implementation Result Commit/Checkpoint/Test Evidence/Self Review、Review Verdict/ReviewResult/Finding 使用判别 Schema；Manifest 固定 Producer Tuple、文件 SHA-256 和字节数；
- `REQ-0014-04`：Execution Intent 使用稳定 Run ID 与独占创建；新 Fake Runner 从 Manifest 恢复时执行计数为 0；Intent 无 Manifest 返回不可重试 `UNKNOWN_SIDE_EFFECT`；
- `REQ-0014-05`：新增 6 个 Role Runner 场景，与 TASK-0013 共 15 项目标测试；现有单 Agent Coding、Codex/Claude/Fake 与真实 Restate E2E 全部通过。

## 自动化证据

- `npm run typecheck && npm test -- --run tests/unit/core-control.test.ts tests/unit/role-runner.test.ts`：通过，2 个文件 15 项；
- `npm run check`：通过；TypeScript、19 个单元测试文件共 111 项及文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项，既有 Coding Workflow、未知结果与 Worker 恢复未回退；
- `ruby scripts/docs_graph.rb validate`：通过，145 个文档节点、242 条关系、98 个 Markdown 文件；
- `git diff --check`：通过。

## 失败路径

- Attempt 不是 Pending Dispatch 的 Task/Role/Dispatch，或历史 Generation 不连续：拒绝；
- 终态 Attempt 再启动、取消，或成功 Attempt 再 Retry：拒绝；
- Result 与 Request/Attempt 不一致、时间倒退、Result/文件 Digest 被篡改：拒绝；
- Docs 缺 Design、Implementation 缺 Result Commit/Self Review/Test、Review Finding 与 Verdict 矛盾：拒绝；
- Artifact Root 为文件系统根、位于输入 Scope 内、直接符号链接或 Run 目录逃逸：拒绝；
- Execution Intent 已存在但没有完整 Manifest：返回 `UNKNOWN_SIDE_EFFECT`，执行计数保持 0；
- 失败 Result 不满足成功完成输入，不能推进 Core Projection。

## 边界

- 本 Task 交付统一协议与确定性 Fake Role Runner，不声称真实 Docs/Review 模型 Adapter 或 keyed Restate Core Workflow 已接入；
- Review Finding 生命周期、Retry/Repair/Replan 控制事件、Verification、最终 Docs Impact 与 Closure 由后续 Slice 实现；
- 没有新增依赖、后台进程、容器或远程 Artifact Store。
