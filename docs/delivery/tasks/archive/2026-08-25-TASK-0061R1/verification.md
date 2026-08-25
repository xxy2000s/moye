# TASK-0061R1 Verification

> 状态：Accepted

| Requirement | Evidence | 结果 |
|---|---|---|
| REQ-0061R1-01 | `CoreV2Workflow` 保留原 `TaskAuthority.claim → intake-time` command 序列，全部 replay-sensitive validation 在 `intake-time` 的 `ctx.run` callback 内执行；重放消费 Journal 结果而不重新读取部署开关 | PASS |
| REQ-0061R1-02 | `validateCoreV2Input` 统一五类输入校验；Core v2 Workflow unit 验证 disabled/enabled acceptance 配置的稳定结果 | PASS |
| REQ-0061R1-03 | Invocation Inspector unit 分别通过 paused durable Run 与精确 Restate 570/index-1 HandlerReturn mismatch，并拒绝普通 index-1 失败 | PASS |
| REQ-0061R1-04 | 真实暂停 Source Invocation 生成 Fact 后，由 `CoreV2FailureRecoveryWorkflow` 完成 Failure Artifact、Knowledge、Closure、Archive | PASS |
| REQ-0061R1-05 | 恢复前后 Role/Attempt/Session 数均为 5；Trusted Test=0、Merge=null；原 Source Projection Digest 保持 `sha256:5ff3e6...` | PASS |

## 真实 Runtime Recovery

- Task：`TASK-RCV-20260825185538-01-SESSION-CAPTURE`；
- 原 Workflow：`restate://CoreV2Workflow/TASK-RCV-20260825185538-01-SESSION-CAPTURE`；
- 原 Invocation：`inv_1360ZAEX4nJl3xsrzeiOS0IlUKug0LTSaN`，状态 `paused`；
- Recovery Workflow：`restate://CoreV2FailureRecoveryWorkflow/TASK-RCV-20260825185538-01-SESSION-CAPTURE`；
- Recovery Invocation：`inv_1360ZAEX4nJl3qr2Cmqhvv9SH2lwC3EgTE`，状态 `completed`；
- Invocation Fact：`sha256:5b3b1df86e8cf9b5a525aaa79ccdedfb01552c9b2bc8e7bb9f3925fb0f908481`；
- Source Projection：`sha256:5ff3e6fb0a81379ddef52b9ad8ede82670142174db949387e73abf103c1e3085`；
- 原失败：Restate 570，`pre-dispatch-journal-mismatch`，index `1`，Failure Digest `sha256:b69e481e49be84b780f1dfacc078051381974f0e9fed12679f29f7d0b19f038f`；
- Failure Artifact：`sha256:43eaa0fc0b3ad5a6fe0de4327bb8e825cf55eca9506b72ffb703a177733bd982`；
- Knowledge Disposition：`none`，Digest `sha256:f270033a17d78f62724746c5a6e9a3b41ee01627a7bb421bb6532b7f5fa054fe`；
- Failure Closure：`sha256:9a58da20a55e7a9d20bb4ebb691437667e2a95dbeeccd9d62120bafd82b7d334`；
- Archive Receipt：`sha256:157c97654ab9174f8a20fbe08cf18a0faa45e47f878e77889d273f4daa5731bc`；
- 最终 Projection：`sha256:4049c8e0b1aad99720575056b911b6ebae8d946730ef6ccb7440e824e79f7f04`；
- 终态：`CLOSED + ARCHIVED + FAILED_TERMINAL`。

恢复只追加 Sequence 9～14：Failure Artifact、Knowledge Disposition、Failure Closure、Archive Pending、Task Closed、Archive Archived。未出现 Test、Merge 或新 Role Event。

## 自动化证据

- Targeted：2 files / 20 tests；
- Unit：44 files / 260 tests；
- E2E：12 files / 32 tests，2 个显式真实入口跳过；
- `npm run check`：Seal Stage 后执行最终 Graph/Docs Impact 门禁。
