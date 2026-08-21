# TASK-0018 Design

## Closure Gate

`core-closure.ts` 只接受经 Expected Digest 恢复的 Envelope/Core Projection 和显式 Trace Index。它从 Projection 推导 Outcome，不能由调用方任选：Passed Review + Verification + Passed Docs Gate 产生 Success；预算 Terminal Candidate 产生 Failed；Cancellation Candidate 产生 Cancelled。

## Workflow

`CoreClosureWorkflow/<task_id>` 是唯一写入者。确定性 Scenario Runner 在一个稳定 Effect Intent 下生成完整 Core Artifact；Artifact 已存在时先校验 Digest 并复用。Worker 可在 Artifact rename 后退出，Restate 重放仍只读取同一结果。

## 故障注入

测试专用 `MOYE_TEST_FAULT_INJECTION=enabled` 才允许进程退出注入。故障目标由显式 Marker/Artifact 路径限制在 E2E 临时目录；正常运行拒绝 fault 字段。

## 正交状态

CoreClosureResult 一经确认即不可变。Observer/Board/Archive/外层 Merge 只保存自身结果或错误，不能覆盖 `outcome/closureDigest`。
