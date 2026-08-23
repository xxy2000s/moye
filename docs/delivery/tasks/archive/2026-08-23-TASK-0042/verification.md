# TASK-0042 Verification

> 状态：Accepted（Seal Pending）
> 证据边界：本 Task 验收成功 Closure/Archive-only retry、停滞 Workflow successor 和历史 Trace 兼容；不代表完整真实 Agent 故障矩阵已完成。

## Requirement → Scenario → Execution → Evidence

| Requirement | Scenario / Test Case | Execution / Evidence | 结果 |
|---|---|---|---|
| REQ-0042-01/02 | 成功 Merge 后冻结 Closure，再执行独立 Archive Effect | `TASK-CORE-V2-SUCCESS-ARCHIVE-001`；Closure `sha256:647a80c0e84b22253a5c52832e79f85f5d781b145f3e2b352cc9ad03f70134b1`；Archive Receipt `sha256:6a5f564f6823fa9f77fc4e5280ad1f1a490434f02a9594b3535f9dd65eb17937` | PASS（真实 Agent/Restate/Git/Runner） |
| REQ-0042-03 | 第一次 Archive 受控失败，错误 token 冲突，正确 token 只重试 Archive | Event 15 `ArchiveFailed`、16 `ArchiveRetryStarted`、17 `TaskClosed`、18 `ArchiveArchived`；Archive attempts=2；Role Attempt 始终 7、Trusted Test 始终 1、Candidate/Merge 各 1 | PASS（真实 Restate） |
| REQ-0042-04 | Board/Trace 只读取真实 Archive Receipt | Board 从 `archivePending` 移入 `archived`；`archiveStatus=ARCHIVED`；State Machine `consistency=VERIFIED` | PASS |
| REQ-0042-05/06/07 | 暂停 durable Run 的 Invocation/Projection/Authority 核验与 append-only successor | `TASK-CORE-V2-MERGE-UNKNOWN-001/003/004` 均保留原 Projection，successor 只追加 Failure Artifact、Knowledge Disposition、Closure 与 Archive | PASS（真实 Restate） |
| REQ-0042-08 | 完整成功路径产品验收 | 真实 Codex 七个隔离 Session、真实 Candidate、真实 `npm test`、真实双父 Merge、Success Closure、Archive retry 与 Receipt | PASS |
| REQ-0042-09 | Digest/token/fencing/幂等与全库门禁 | 错误 Archive token HTTP 409且 Projection 不变；Invocation/source/predecessor digest 冲突单测；`npm run check`、`npm run test:e2e` | PASS；Seal Receipt 待 Result Commit 后提交 |
| REQ-0042-10 | 不改写旧 schema Projection 的 Trace 兼容 | 真实 LIVE-001～004 详情从 HTTP 500 修复为 200；四项均 `CLOSED + FAILED_TERMINAL + ARCHIVED + VERIFIED`；旧字段缺失 unit 回归 | PASS |

## 真实成功场景

- Task Input：[`evidence/success-archive-input.json`](./evidence/success-archive-input.json)
- Task ID：`TASK-CORE-V2-SUCCESS-ARCHIVE-001`
- Workflow：`restate://CoreV2Workflow/TASK-CORE-V2-SUCCESS-ARCHIVE-001`
- Invocation：`inv_15Ek6ZHk6Nv74XGq11Q3CeKRLdLn0LEX2J`
- Spec Revision / Generation：`1 / 0`
- Base / Candidate / Tree：`f937ab8f21309d47b7e6d173ccb047d897446f6e` / `ab470ff63f87aa9cfbff478862be777ca7f8a120` / `0f256631a420a4ddc863b63684bf5d992def72eb`
- Checkpoint Digest：`sha256:acccebe51ae34c55ae3a7cf4c674351451759b2a1778ce843eac9ce8e996c374`
- Test argv / exit：`["npm","test"]` / `0`
- Trusted Run / Manifest：`sha256:df8b71c528ff1fb23b33256ed221db1b8da6ae73fdfd1830cc9800a2d3bf0f66` / `sha256:34482252fd3ba141f8e1000c4698e0b33b339b1c1d41b6e15ee8235d5d946bc0`
- stdout / stderr Digest：`sha256:419c4fd14fceb37285bfcb73dba8b44aa3b2c0235746b2ac19342846507ba855` / `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- Test Report / Final Review：`sha256:da8bd91bfdaa43be42760d086f5b00c2f649b450f290a12a3281694fab1309e9` / `sha256:eefc5abbeeb4425f615b01ed1aa6a42f1a6381e10376157e43c534a3344eab82`
- Verification Gate：`sha256:9301c31d0463b131a5135d1d545541caf5f4639ff2d9c5251e770e17ded96f4c`
- Knowledge Disposition：`none`，Digest `sha256:4ea929a8d7d3cc50784d79eb5abb9c2b589c8a3f79b02df34a715c3628c0a347`
- Merge Effect / Commit：`local-merge-effect:sha256:0f17c6bf62aaeca070de85746f1c539afe499515f8f94e3c3619a54d71863ceb` / `e0ca45a9ac9421aff29c4d9c5822534a23de548f`
- Merge Receipt：`sha256:b4cde7d9531511f98342df67cdab7c6ef391a5535babd867d4c616ea6aa29287`
- Closure Outcome / Digest：`SUCCEEDED` / `sha256:647a80c0e84b22253a5c52832e79f85f5d781b145f3e2b352cc9ad03f70134b1`
- Archive Effect / Receipt：`sha256:12705eb744eb018a1f71643c5e421505698387574aae13629b03c136892badae` / `sha256:6a5f564f6823fa9f77fc4e5280ad1f1a490434f02a9594b3535f9dd65eb17937`
- 最终 Projection：`CLOSED + SUCCEEDED + ARCHIVED`，Digest `sha256:73a15c5819377c8a21d36ec921a588f828d2bdb2109074a4b39f0166ed0ac04a`
- 页面：`http://127.0.0.1:3000/tasks/TASK-CORE-V2-SUCCESS-ARCHIVE-001`（最终服务切到 3000 后）

## Role Attempt / Session / Event Evidence

| Phase | Attempt | Session | Events Digest |
|---|---|---|---|
| ARCHITECT | `...ARCHITECT.r1.g0` | `01a02de9-3342-7002-b93f-17daa6fc3d21` | `sha256:dadf298982a2a99c59ca3fd09128a619f79038678d18a51e6a193815617165a7` |
| DESIGN_REVIEW | `...DESIGN_REVIEW.r1.g0` | `01a02de9-f4e0-7b71-8e78-5dcf559a0a83` | `sha256:d90cf2794eef0893b2aaf7d202a5e6ade2ba30762d37a452c60cde8840223a3b` |
| IMPLEMENTATION | `...IMPLEMENTATION.r1.g0` | `01a02dea-9599-7ef1-bdea-a35e438a5d6c` | `sha256:a3f4779bbccf4d230608450ceaae38e163d4a1347ef5696a63c5b1a1e73e72f5` |
| DOCUMENTATION | `...DOCUMENTATION.r1.g0` | `01a02deb-cc17-7370-804d-184094a2a472` | `sha256:e45049d5fd46961c535e32d447eaf461393684caf6d233df013f7e420e0d7bd8` |
| TEST_PLAN | `...TEST_PLAN.r1.g0` | `01a02ded-6041-72d1-ba9b-4a7341ee79f9` | `sha256:3e2dca0d21d1b675b2bfe32f47a0a61b43f755d408b40761555034c5fab8c02c` |
| TEST_ASSESSMENT | `...TEST_ASSESSMENT.r1.g0` | `01a02ded-e64a-7a62-89d1-f3a09f1ff75a` | `sha256:4aa317aab27565707710fb35149133d6c3cb23daac66789b85d2169e2e3609e5` |
| FINAL_REVIEW | `...FINAL_REVIEW.r1.g0` | `01a02dee-5298-7760-8518-c10a5608be64` | `sha256:711e621726acac57eaa91e60a7554b86252c4d45199282c391f2c6806d546ed6` |

每个 Event Ref 均保存在对应 Role Manifest，并由 `/api/tasks/TASK-CORE-V2-SUCCESS-ARCHIVE-001/roles/<run-id>/events` 在弹窗数据源中读取。生命周期 Event 1～18 记录从 Architect 到 Archive retry 的真实顺序。

## 唯一性与历史收敛

- 七个 Role Phase 各一个 Attempt/Session；错误 token 和 Archive retry 后仍为 7；
- Trusted Runner Manifest 只有一个 Test Case execution；
- `base..release` 恰有两个 Commit：一个 Candidate、一个双父 Merge；Merge parents 精确为 Base + Candidate，worktree clean；
- Archive retry 没有创建第二个 Candidate、Test、Verification Gate 或 Merge；
- `TASK-CORE-V2-MERGE-UNKNOWN-001/003/004` 的 successor Trace 均 `consistency=VERIFIED`，分别保留 0/7/7 个原 Attempt 与 0/7/7 个原 Session；
- LIVE-001～004 均为 `CLOSED + FAILED_TERMINAL + ARCHIVED`，原失败阶段分别为 Architect、Architect、Implementation、Test Plan，Archive Receipt Digest 分别为 `sha256:260e07…087`、`sha256:9d86e3…45d6`、`sha256:9a8edf…fb4f`、`sha256:ef2cec…3f4b`；
- 所有历史收敛通过 TaskAuthority 指向合法 successor；原 keyed Workflow、Invocation、Attempt、Session、Event 和失败原因未删除、未覆盖、未补写 Projection。

## 验收限制

- 当前环境没有可连接的浏览器实例，因此本轮完成了页面 API、路由数据和静态资源测试，但没有把实际点击/视觉截图伪装成已完成；最终服务会在 3000 提供人工验收。
- TASK-0042 不证明 Implementation/Final Review/Documentation/Test Finding、Design Replan、两种 Test UNKNOWN、Worker 高风险边界、预算耗尽、Observer 故障与 stale Attempt 的真实 Agent 场景；这些仍由 TASK-0043～0048 逐项完成。
- 完整多 Daemon Lease/Fencing、远程 PR、权限、多租户和生产部署仍属于生产阶段能力。
