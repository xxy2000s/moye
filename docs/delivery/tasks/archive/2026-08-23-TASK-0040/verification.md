# TASK-0040 Verification

> 状态：Accepted  
> 验证日期：2026-08-23

## Requirement → Test → Evidence

| Requirement | Test / Execution | Evidence | Result |
|---|---|---|---|
| REQ-0040-01/02 | Core v2 Lifecycle reducer unit | `core-v2-lifecycle.test.ts`：失败事实、Artifact、Disposition、Closure、Archive event/digest | PASS |
| REQ-0040-03 | Archive Failed/Retry reducer unit | 同一 Effect ID、attempt 递增、非 Archive Failed 拒绝 retry | PASS |
| REQ-0040-04/05 | 真实 Restate legacy successor E2E | `restate-recovery.test.ts`：原 Projection 不变、Authority successor、Board/Trace 解析与 `VERIFIED` | PASS |
| REQ-0040-01/02/05 | 新真实 Agent 失败 Task | `TASK-CORE-V2-FAILURE-CLOSURE-001`：6 个真实 Codex Session、真实 Candidate/Trusted Runner，失败后 owning Workflow 自动 Closure + Archive | PASS |
| REQ-0040-04/06 | 历史真实 Agent 恢复 | `TASK-CORE-V2-LIVE-001`～`004`：原 Workflow 保留，四个 successor 均 `CLOSED + FAILED_TERMINAL + ARCHIVED` | PASS |
| REQ-0040-06 | 全自动门禁 | `npm run check`：34 files / 192 tests；`npm run test:e2e`：12 files / 29 tests | PASS |

## 新失败 Task 产品证据

- Task ID：`TASK-CORE-V2-FAILURE-CLOSURE-001`；
- Workflow：`restate://CoreV2Workflow/TASK-CORE-V2-FAILURE-CLOSURE-001`；
- 原始失败阶段：`TEST_ASSESSMENT_REQUIRED`；
- Outcome / Archive：`FAILED_TERMINAL / ARCHIVED`；
- Candidate Commit：`e3079a344a9004824f48ebe68627a195bd309c21`；Tree：`aef4aa31868135100d033866f6ed3fb808954bc0`；
- Checkpoint Digest：`sha256:daafd405746fb77fadae5bfe41978a2a249afa2ca2cf3390d73af09ef85fdd82`；
- Trusted Runner Manifest：`sha256:631b0ee56bc4d61f01d1682eb063948fc48b04b803a684284706db1553c9794f`；实际 argv 为 `node -e process.exit(7)`；
- 六个 Session：`01a02d3c-fc04-7770-b8e9-0066fd7ac331`、`01a02d3d-c57c-7170-811f-4398ffa163a3`、`01a02d3e-459d-7041-9e17-9e96a53bbeac`、`01a02d3e-fe09-7252-8f17-5f1eade1ea44`、`01a02d41-08a3-7742-9a35-76e3ab8d91f2`、`01a02d41-4411-72a0-9f5b-dd6e1cca8813`；
- Failure / Knowledge / Closure / Archive Digests：`sha256:013a6ca721b22624323c0d2d0c9937c6ef36e7057afbe23c9eec6399d4cbedd5`、`sha256:3b3682401494933bab856c83bb87f99186886b7e073b108830b5ff41f47f4f0a`、`sha256:8e5691c957c323dff85e9c12a7050cc622791e05963ee7a5ad81c35ad7b6d372`、`sha256:22edca96d2b3ba0e4fe92aa7c40fb507cacf157f647ead5ae3172f34bbc461e5`；
- 页面：`/tasks/TASK-CORE-V2-FAILURE-CLOSURE-001`；Trace 为 `Projection = Event History / VERIFIED`。

这次执行同时确认一个独立问题：失败测试的 Test Assessment 输出成为 `INVALID_OUTPUT`，在形成 Repair 前终止。它已进入真实 Finding `core-v2-test-assessment-finding-can-bypass-repair` 与 BL-0043；因此本证据只证明失败 Closure，不冒充“Test Failure → Repair”场景通过。

## LIVE-001～004 历史收敛证据

| Task | 原失败阶段 | 原 Attempt / Session 数 | Failure Digest | Closure Digest | Archive Receipt Digest |
|---|---|---:|---|---|---|
| `TASK-CORE-V2-LIVE-001` | ARCHITECT_REQUIRED | 1 / 1 | `sha256:66719bdba086d4055f84380c1322473730b9b8b64f2057b5074493869e912041` | `sha256:7e8fc0df6b62035e68c332b2aba2f84c6959b63b984cc2988dbc258835eac740` | `sha256:260e07fd6c3563daa46d2d2de36e226dee1cf690a39b1b47e124a55a07caf087` |
| `TASK-CORE-V2-LIVE-002` | ARCHITECT_REQUIRED | 1 / 1 | `sha256:92915ec28d925337df738c1253d16a3a085fc8c5caba966854ab980057a56396` | `sha256:57a110cd3617928feb7e8601e7572b80599b55186d1e4454ec12e9c9586af5f8` | `sha256:9d86e3c06c45db27d999ee15b1d06700c072eafdaa1a64d782938d807a0745d6` |
| `TASK-CORE-V2-LIVE-003` | IMPLEMENTATION_REQUIRED | 3 / 3 | `sha256:906082e14299a0e2c5546902400edb49b112ce6f3fde7e92bd059eb8865dd5c5` | `sha256:fe84c31d7d407380e159076701ec8c9bca09bd12a4aada9f01694e2eaac701b6` | `sha256:9a8edfe8566e54342492ff82e453c312c4b9fd643070743d49b0c99e7f46fb4f` |
| `TASK-CORE-V2-LIVE-004` | TEST_PLAN_REQUIRED | 5 / 5 | `sha256:e574677a58f88a07d3ad6e651652ea746ffb3cfffdfd5ba3a6ffa300ad1a9405` | `sha256:a45fad6087962b2165f3c17abdb70bb848c246443786fec8539979816bf55cc9` | `sha256:ef2ceceaf94027d7b91b41c9982d7c414a99b8f42fca5f85ffed014d1c963f4b` |

四个 Task 的 `TaskAuthority` 均保存原 `restate://CoreV2Workflow/<task_id>` 与新 `restate://CoreV2FailureRecoveryWorkflow/<task_id>`；原 Workflow 的 Attempt 数和 Event History 未改变。ProjectBoard `archivePending` 中已没有 LIVE-001～004。

## 证据边界

- 单元测试证明 Reducer 与 Effect identity；
- 自动化 E2E 使用真实 Restate、进程和文件 Artifact 证明 successor/Board/Trace，不代表真实 Agent 故障矩阵；
- `TASK-CORE-V2-FAILURE-CLOSURE-001` 与 LIVE-001～004 是真实 Codex Session 产品证据；
- Repair/Replan/UNKNOWN/Worker/Git/Merge/预算/Observer/stale Attempt 的十五场景矩阵仍由 BL-0043 后续 Task 验收。
