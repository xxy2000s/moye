# TASK-0076 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0076-01/02 | Happy/Fault/Recovery/Guard/Framework harness 统一 `full` Session Evidence；临时 Service 显式 Provider allowlist | 每个未来已完成 Role 必须通过 Receipt/Manifest/Authority/Timeline fail-closed audit；Framework 公共隐私默认仍为 `none` |
| REQ-0076-03/05 | `acceptance:agent-sessions:history:matrix` 对 W09 六个显式 Task 执行 append-only enrichment 与幂等重放 | 6 Task、44 Role、1554 canonical Event，全部 `PARTIAL`；Matrix Digest `sha256:08fad49ce89ff12ff1cbc1794a3f7c501b42cb7f6b561b266b3d8ac8ae4157e2`；无 `UNAVAILABLE` |
| REQ-0076-04 | 历史 `TASK-RCV-20260826114418-01-ROLE-RECOVERY` 七个 Role 的 Board `/session`、`/timeline`、`/events`、`/stderr` 验收 | 7/7 `PARTIAL` 可读，共 271 Event；状态分别为 32/16/61/106/14/14/28；原 Projection Digest 前后均为 `sha256:48d0fbf24d940167936e1d90197bd7b241e8f4ade2d0117ac176eecc56af6858` |
| REQ-0076-01/06 | 新真实 `TASK-RCV-20260826144141-01-ROLE-RECOVERY` 在 Architect、Implementation、Final Review Manifest 边界三次强杀 | `CLOSED / SUCCEEDED / ARCHIVED`；7 Role Session Evidence 全部 `COMPLETE`；唯一 Candidate `f74c899e…`、Merge `00ce56d3…`、Gate `sha256:4f333b60…`、Projection `sha256:f2afc77e…` |
| REQ-0076-07 | 无 Task 的 cleanup smoke 注册临时更高 revision、PATCH predecessor、停止临时 Service、读取既有 Timeline | 最高 CoreV2 revision 63 的 URI 回到 `http://host.docker.internal:55922/`；停止后历史 Timeline 立即返回 32 Event |
| REQ-0076-06 | `npm run check`、`npm run test:e2e`、文档图与 Impact Gate | 56 unit files / 305 tests 通过；13 E2E files / 35 tests 通过，2 项按既有条件 skip；文档图有效 |

## Evidence boundary

- 历史结果为 `PARTIAL` 是因为当时没有 Prompt Envelope，enrichment 的 `promptBinding=UNVERIFIED`；Provider 源、解析和 Timeline 内容存在，不提升成虚假的 `COMPLETE`。
- 本批 44 个 Provider Session 源预检为 44/44 存在，因此没有形成 `UNAVAILABLE`。未来源确实缺失时入口会保存并展示 `UNAVAILABLE`，不会重跑旧 Agent。
- 历史 enrichment 只追加 `SessionEvidenceRegistry` Sidecar；没有修改 Core v2 Projection、Role Manifest、Attempt、Session ID、Domain Event、Closure 或 Archive。
- 新真实 Task 的三个强杀 marker 各一份，Role Run、Receipt、测试、Candidate 与 Merge 均唯一；Session Capture 恢复没有启动第二次 Agent。

页面：

- `http://127.0.0.1:3000/tasks/TASK-RCV-20260826114418-01-ROLE-RECOVERY`
- `http://127.0.0.1:3000/tasks/TASK-RCV-20260826144141-01-ROLE-RECOVERY`
