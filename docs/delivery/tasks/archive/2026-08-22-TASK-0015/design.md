# TASK-0015 Design

## 模块边界

新增 `src/domain/review-finding.ts`，保持纯领域、无文件系统和 Restate 依赖：

```text
ImplementationSelfReview
          │ READY + Candidate/Diff/Evidence binding
          ▼
       ReviewInput
          │ successful Review execution
          ▼
 ReviewResult ─────── ReviewFinding records
          │                 │ append-only disposition history
          └────────┬────────┘
                   ▼
             ReviewGateResult
                   │
       PASSED ─────┴───── BLOCKED
 Verification Required   Repair Required
```

`ReviewExecutionFailure` 是执行通道失败事实，不进入 ReviewResult/Finding Gate。Role Runner 继续负责执行 Manifest 与 Artifact 文件完整性；本模块负责 Artifact 内容代表的业务语义和 Candidate 绑定。

## Finding 记录

- `findingId` 只由首次发现的 Task/Spec/Candidate/Review Attempt/Category/Severity/Summary 和引用生成，后续状态变化不改 ID；
- `findingDigest` 覆盖状态与完整 `dispositions`；
- 每次处置记录 From/To、Actor、Reason、Evidence 与稳定 Disposition ID；
- 终态处置不允许回到 OPEN，相同输入重放返回原记录。

## Core Gate

Review Role 成功完成只证明 Agent Run 已确认，不等于 Review 通过。Core Reducer 先进入 `REVIEW_GATE_REQUIRED`，再验证内容寻址 Gate Result 与最近 Role Manifest Digest；Gate 自身再绑定业务 ReviewResult Digest：

- 无 `BLOCKING + OPEN` → `VERIFICATION_REQUIRED`；
- 存在未解决 Blocking Finding → `REPAIR_REQUIRED`；
- 重放同一 Gate 不推进 Projection，冲突 Gate 拒绝。

Slice 4 再消费 `REPAIR_REQUIRED` 并创建绑定 Finding 的新 Implementation Attempt。
