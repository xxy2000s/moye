# TASK-0061 Verification

> 状态：Accepted

| Requirement | Evidence | 结果 |
|---|---|---|
| REQ-0061-01 | `session-capture-effect.test.ts` 验证 Prompt Envelope 在 Agent 计数前 create-once 落盘，并与 exact rendered Prompt/Prepared Request 绑定 | PASS |
| REQ-0061-02 | Core v2 Projection 为每个 Role 保存 PREPARED→RUNNING→AGENT_COMPLETED→CAPTURE_PENDING Locator；真实最终 Projection 7/7 Locator version=4 | PASS |
| REQ-0061-03 | `captureLiveRoleSessionV1` 独立写 Intent、raw、normalized、Manifest、Receipt 与 Authority；七个真实 Receipt 均为 COMPLETE | PASS |
| REQ-0061-04 | Unit 在 Manifest 后抛出受控丢回执、移走 Provider 源后从受管 Manifest 恢复，再次重放返回同一 Receipt Digest；Agent Run 计数=1 | PASS |
| REQ-0061-05 | 七个真实 Session Evidence 的 `executionEventsRef/stderrRef` 与对应 Role Manifest 完全相等，Transcript 使用独立 Artifact refs | PASS |
| REQ-0061-06 | Authority/Receipt 固定 `DIAGNOSTIC_SUPPLEMENT_ONLY`；Projection 以 Attempt/Revision/Generation/Run 身份 upsert，不进入 Verification Gate | PASS |
| REQ-0061-07 | `npm run acceptance:core-v2:sessions`：真实 Restate、真实 Codex、隔离 Git、真实 Trusted Runner、受控 Service 终止、Merge/Closure/Archive | PASS |

## 真实产品证据

- Runtime Task：`TASK-RCV-20260825190550-01-SESSION-CAPTURE`；
- Workflow：`restate://CoreV2Workflow/TASK-RCV-20260825190550-01-SESSION-CAPTURE`；
- 终态：`CLOSED + ARCHIVED + SUCCEEDED`；
- Evidence Root：`.moye-runtime/acceptance/core-v2/recovery-20260825190550-22249`；
- Candidate / Merge：`899d6be34561777585a786d0b62a9950472a1154` / `cf0040c5380a0b9d9047c8591efaa10391cd8dff`；
- Verification Gate：`sha256:78210a0c4cf2b9229101de00bfde944e1b16a0d79fac8c97014fd895cba01a91`；
- Closure / Archive：`sha256:8bdca3598b4e1b621834129f3db81fb937dc86056a1ac9c6a383acdf198aa98c` / `sha256:06e268088d4ca46a41bc41f77ad147a642087a06b4efa31e3b22ba0038fea83a`；
- Projection：`sha256:336259e38562364d604947094001c36bce545d4155603519daaa0683e6720651`；
- 故障证据：唯一 `session-capture-manifest.marker`；强制终止后首个 Capture 从已写 Manifest 恢复，没有第二个 Agent Run。

| Phase | Session | Prompt Envelope | Transcript Manifest | Receipt |
|---|---|---|---|---|
| ARCHITECT | `01a03a50-92a3-70e1-88ce-93619bab27e5` | `sha256:7288fd12a3bf60657d44760d67d8b54b44ae42059a3a0a77d24c1a3259bd67f8` | `sha256:4dec649e2383a0488c7762ecdddecdf6ccce380ef8aa4c43a65e38b6173ed0e4` | `sha256:aa00cb728ce0362c3c14fff795e8fdaafe5190d773721bdbb0d511364e1ebd6e` |
| DESIGN_REVIEW | `01a03a51-58c9-7480-9cec-86ad52de3318` | `sha256:99432aa5eb46c1d918f195cd2e7e3ab1358a383db1e4eef2573a164e941c7f15` | `sha256:cbca53bdd471236691ce447d932d2181ec11d1ae4e6cbf7d9f4d7621bd3a8c19` | `sha256:5ef12ef1d9aad905e31d9e07b8e7e4fc0ddaddcf6ac27a159f2cba0ced1488d3` |
| IMPLEMENTATION | `01a03a51-a446-71b2-9e1c-ce5560283c54` | `sha256:a7bf0d09cdee066a520e2958814edf28a0bab91fab57ee2d023b4badc96541fd` | `sha256:2857c8937f6000af93e0884ca2ae1a3dbcfef607c69d3f593bfea8509b795098` | `sha256:d4b7295c54a1d5641cc01d9d49b9d19f9e93d268e7ec2381057cb53e9519fd2e` |
| DOCUMENTATION | `01a03a52-67f6-71a2-8e31-cdbbe4bfb6e3` | `sha256:5544510d5c327fb9843332fffaead03dffe582fef2f2eb79362c266d804f0807` | `sha256:5ee767eea24873d5d68a03d9df106d49cb2a5b9967e06e2e4c9d07af0518648c` | `sha256:4fa8bfeb53b752af629f2598efa3a937c404997829feb2f0c262d64f921de055` |
| TEST_PLAN | `01a03a54-354c-7c00-9896-b4bdbf518f36` | `sha256:ea1646d147bb5a8ce311d5da6fd0887f3513c82dcd46e0e5a90ad5c5367514b5` | `sha256:bc1daa7c810bb5ce3af4024298178c1092168878abe07d59e6fd9eae9537489b` | `sha256:9ff4099f3e326afe1044af61b007492e4f5ecc0e4662b3f879e8aea04072b3eb` |
| TEST_ASSESSMENT | `01a03a54-690e-7fd2-bf8b-90b856d2bbde` | `sha256:8b2572fb3a48c5f09a275f1093b2fc19b37b5b10caf0a357e7cea78ea4c13f26` | `sha256:73787cc9675a27dd8c83785f3222350933ac12f4a8a8ecaec03cf1b843f4d2db` | `sha256:2ec3f6ac96a0da45f0d045807fd1aa1d5bc864b9f335bf02fa8ee854ee9214ce` |
| FINAL_REVIEW | `01a03a54-9c62-7831-a65b-e5a7faaff393` | `sha256:396cc9ae6d2a0c962606f0adc599904f6757710325a4bed066a8ac97f9919b87` | `sha256:4be61813c48bd91cca69a1c49c407e4cf6661b7547d9b51fdb6df60d93ad5d44` | `sha256:1cf363ea188171d3fd9339f84ce31f602e26baf12f83d14a9bc7336ab49ab29a` |

## 自动化门禁

- `npm test`：44 files / 257 tests；
- `npm run test:e2e`：12 files / 32 tests 通过，2 个显式真实入口跳过；
- `npm run acceptance:core-v2:sessions`：真实产品场景通过；
- 首次真实运行暴露 `TRANSCRIPT_COMPLETE_WITH_GAPS`，见 Finding `codex-current-item-completed-dialogue-misclassified` 和 BL-0072；失败 Workflow 与 Session 未删除。

## 保留的失败恢复事实

首次任务随后使用 Restate 正式 `resume --deployment latest` 接管，已从原 Journal 推进至 `TEST_EXECUTION_REQUIRED`，前五个 Role 没有重跑。一次遗漏验收开关的部署在首个 durable command 前写入不同的 Handler Return；正确部署再次重放时形成 `570 Journal mismatch`。原 Invocation `inv_1360ZAEX4nJl3xsrzeiOS0IlUKug0LTSaN` 已通过 Restate 正式 Pause 保留，未取消、重提 key 或修改 Projection。该独立 Core 缺口已进入 Finding `core-v2-replay-config-mismatch-not-recoverable` 与 BL-0073，须由 TASK-0061 之后的独立 append-only recovery Task 收敛；它不作为本 Task 成功产品验收的通过证据。
