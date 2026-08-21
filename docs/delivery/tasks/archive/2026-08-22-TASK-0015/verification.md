# TASK-0015 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0015 满足 Spec Revision 1：Implementation Self Review、Candidate-bound Review Input、成功 ReviewResult、独立 ReviewExecutionFailure、ReviewFinding 追加处置和 Blocking Gate 已成为内容寻址领域事实。Core 在 Review Role Manifest 确认后停在 Review Gate；开放 Blocking Finding 进入 `REPAIR_REQUIRED`，无开放 Blocking Finding 才进入 `VERIFICATION_REQUIRED`。

## Requirement 证据

- `REQ-0015-01`：Self Review 固定 Implementation Attempt/Run、Candidate、Diff、Checkpoint、Tests 和 Checklist；Expected Digest 恢复拒绝篡改；`CHANGES_REQUIRED` 不能创建 Review Input；
- `REQ-0015-02`：Review Input 绑定 Self Review 与验证证据；ReviewResult 绑定 Review Attempt/Run、Role Manifest Digest 和 Finding Origin；正常 Verdict 与执行失败使用不同判别对象；
- `REQ-0015-03`：Finding ID 由不可变首次发现事实生成，Record Digest 覆盖状态和处置历史；处置追加 Actor/Reason/Evidence，相同输入重放幂等，终态不能复活；
- `REQ-0015-04`：Gate 校验精确 Finding 集与 Origin Digest；`BLOCKING + OPEN` 阻塞；Core 再校验 Gate 的 Role Manifest Digest 与最近完成 Review 一致；
- `REQ-0015-05`：新增 6 个 Review/Finding 场景，与 Core/Role 协议共 21 项目标测试；现有单 Agent Coding 和真实 Restate E2E 全部通过。

## 自动化证据

- `npm run typecheck && npm test -- --run tests/unit/review-finding.test.ts tests/unit/core-control.test.ts tests/unit/role-runner.test.ts`：通过，3 个文件 21 项；
- `npm run check`：通过；TypeScript、20 个单元测试文件共 117 项及文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项；
- `ruby scripts/docs_graph.rb validate`：通过，151 个文档节点、251 条关系、102 个 Markdown 文件；
- `git diff --check`：通过。

## 失败路径

- Self Review Verdict 与 Checklist 矛盾、Digest 篡改或 `CHANGES_REQUIRED` 试图授权 Review：拒绝；
- `PASSED` 携带 Finding、`FINDINGS` 缺 Finding、Finding 与 Candidate/Attempt/Run 不一致：拒绝；
- Review Runner 失败只形成 `ReviewExecutionFailure`，不能作为可信 ReviewResult 进入 Gate；
- Finding 处置 Expected Digest 过期、处置内容冲突或终态复活：拒绝，历史保留；
- Gate 缺失 Result 中的 Finding、Origin 不匹配、Role Manifest Digest 不匹配或不同 Gate 重放：拒绝；
- 开放 Blocking Finding 无法进入 Verification；处置为 Resolved 后相同 Review 历史可通过 Gate。

## 边界

- `REPAIR_REQUIRED` 是明确停止点；本 Task 不创建 Repair Attempt、不扣 Repair 预算，也不实现 Replan；
- `ACCEPTED_RISK` 只是显式处置状态，不声称完成了人类审批或 ADR；
- 真实 Review 模型 Sandbox、Verification 和 Closure 仍由后续 Slice 接入。
