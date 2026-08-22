# TASK-0019 Verification

> 状态：Accepted

验收类型：真实产品链路。

## 真实 Codex 产品验收

执行命令：

```bash
npm run acceptance:live
```

该脚本启动隔离 Restate 与临时 Git 仓库，并经页面使用的同一个 `POST /api/tasks` API 提交任务。产品入口先拒绝 `FAKE`，随后真实启动一次 Implementation Codex Session 和一次独立只读 Review Codex Session；成功后校验 Result Commit、用户验证命令、目标分支合入、Board Closure 与 Archive。

2026-08-22 冻结证据：

- Task：`TASK-LIVE-20260822031920-D8559DEA`
- Fake 请求：HTTP 400，`REAL_RUNNER_REQUIRED`
- Codex：`codex-cli 0.146.0`
- Implementation Session：`01a0277a-e598-7210-8566-96482324fbe9`
- Implementation Agent Run：`agent-run:sha256:bd206613...`
- Implementation Result Digest：`agent-result:sha256:deaa797...`
- Review Session：`01a0277b-99a5-75c2-a9b1-ba60ef73d1da`
- Review Run：`live-review-run:sha256:460a6afe...`
- Review Result Digest：`live-review-result:sha256:a6d212...`
- Review Verdict：`PASSED`，Blocking Finding `0`
- Base Commit：`fb578e3c...`
- Result Commit：`d1688f9dd2ac2d4202d6c07744fe2dcd62948025`
- Verification Binding：`verification-binding:sha256:78d73a...`
- Merge Commit / Target Head：`f6d58d3059954fdace70e6984c0be572076d7f1e`
- Agent Event：20 条
- 业务 Outcome：`SUCCEEDED`
- Archive：`ARCHIVED`

验收中没有用 Fake、Mock 或确定性 Scenario 产生成功结果；Fake 只用于证明产品入口拒绝它。

## 自动化回归

```bash
npm run check
# 26 test files / 147 tests passed；typecheck passed；documentation graph valid

npm run test:e2e
# 5 test files / 14 tests passed（真实 Restate）
```

完整 E2E 首轮发现 BL-0020 kind 不符合 Runtime enum，以及 Demo 仍断言七阶段；修复后全量重跑通过。

## 失败路径证据

- Fake runner 在创建 Runtime Workflow 前被拒绝；
- 真实 Review CLI 参数不兼容时任务停在 `FAILED/REVIEW`，没有 Merge；修正 Adapter 后真实重跑通过；
- Workflow 会把 Blocking Finding 传给新的 Repair Agent Run，重新验证并重新 Review；超过一次 Repair 预算仍有 Blocking Finding 时失败且不 Merge；
- Review Intent 存在但 Manifest 缺失时结果为 UNKNOWN，不盲目再次调用模型。

## 边界

本次交付的是页面可直接使用的真实 `CodingTaskWorkflow` 闭环：Implementation → Verification → independent Review → optional Repair → Merge → Docs disposition → Closure → Archive。通用 `CoreClosureWorkflow` 的 Role Runner 仍是确定性 PoC，独立 Docs Role 和 Spec Replan 尚未接入真实模型；它们不被计入本次产品可用性结论。
