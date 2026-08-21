# TASK-0015 Spec：Self Review、ReviewResult 与 Finding 生命周期

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0016
> 母需求：CORE-REQ-03 / Slice 3

## 目标

把 Implementation 自检和独立 Review 从自由文本提升为内容寻址的领域事实。Review 输入固定 Candidate、Diff 与验证证据；Review Agent 正常完成后产生独立 Verdict 与 Finding；Finding 以追加处置历史保留，不因 Repair 被删除；Core Projection 必须经过 Blocking Gate 才能进入 Verification。

## Requirements

### REQ-0015-01：结构化 Self Review

- Self Review 固定 Task、Spec Revision、Implementation Attempt、Candidate Commit、Diff Digest、Checkpoint 与 Test Evidence；
- Checklist 每项具有稳定 ID、结论和 Evidence，整体产生 Self Review Digest；
- `CHANGES_REQUIRED` 的 Self Review 不得创建 Review Input；
- 序列化恢复必须提供 Expected Digest，篡改拒绝。

### REQ-0015-02：Review 输入与结果

- Review Input 固定 Task、Spec Revision、Candidate Commit、Diff Digest、Verification Evidence、Checkpoint 与 Self Review Ref/Digest；
- ReviewResult 只表示 Review Agent 成功执行后的 `PASSED | FINDINGS`，固定 Review Attempt/Run、Role Manifest Digest 和 Finding 引用；
- `PASSED` 不允许 Finding，`FINDINGS` 必须至少包含一个 Finding；
- Review 执行失败使用独立 `ReviewExecutionFailure`，不得伪装为 Finding 或正常 Verdict。

### REQ-0015-03：ReviewFinding 生命周期

- Finding 固定 Category、Severity、Requirement/Evidence、Summary、Recommended Action、Spec Revision、Candidate 和 Review Producer；
- Finding ID 基于不可变身份稳定生成，Finding Digest 覆盖当前完整记录；
- 初始状态为 `OPEN`，只允许追加 `RESOLVED | SUPERSEDED | ACCEPTED_RISK` 处置；
- 处置必须带原因、Actor 与 Evidence；相同处置幂等，冲突或终态复活拒绝；历史记录不得删除。

### REQ-0015-04：Blocking Gate

- Gate 校验 Review Input、ReviewResult 和全部 Finding 的 Task/Spec/Candidate/Producer/引用一致性；
- 任一 `BLOCKING + OPEN` Finding 产生 `BLOCKED`，否则 `PASSED`；
- Core Review Role 完成后停在 `REVIEW_GATE_REQUIRED`；只有可信 Gate Result 可以推进；
- `PASSED` 进入 `VERIFICATION_REQUIRED`，`BLOCKED` 进入 `REPAIR_REQUIRED`，不得跳过。

### REQ-0015-05：兼容与验证

- TASK-0014 的 Role Runner 继续强制 Implementation Self Review Artifact 与 Review Result Artifact；
- 单测覆盖 Self Review、输入绑定、正常 Verdict、执行失败、Finding 分类/处置/重放/篡改、Blocking Gate 与 Core Stage；
- `npm run check`、真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 本 Task 不实现 Repair/Replan 决策、预算扣减或新的 Implementation Attempt；
- 不把 `ACCEPTED_RISK` 自动提升为人类审批或 ADR；
- 不接入真实 Review 模型 Sandbox，也不实现最终 Closure。

## 完成定义

从结构化 Self Review 可以建立绑定 Candidate 的 Review Input；成功 Review 的 Finding 有可恢复、不可删除的处置历史；Blocking Finding 在 Core Projection 中阻止 Verification；Review 执行失败与 Review 发现问题在类型和 Gate 上明确分离。
