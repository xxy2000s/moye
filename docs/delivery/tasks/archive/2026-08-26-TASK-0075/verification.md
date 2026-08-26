# TASK-0075 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0075-01 | 文档图路由、全图校验、Release/Security/Migration/Limitations 审阅 | README、Architecture、CodeMap、Runbook、Release Notes 与 `SECURITY.md` 已冻结；公开渠道声明均要求远端 Receipt |
| REQ-0075-02 | `npm run check`；`npm run test:e2e`；M1 Session Evidence 只读复核；W09 Runtime live recheck | 301 unit tests、35 E2E tests 通过；M1 报告 Digest `sha256:2301b491843227c1adf04171c91e4f85824f85b3bbaee50f93e78034e4f42b03`；W09 source Digest `sha256:d65f253ba55f8bb00f8ab253706e23b6e4d54d5f6c7f2b0db8b59456942f8354`；本次 live recheck Digest `sha256:4db1d505b2090825a18d804d02603a208f66550576bb53c26aaf4e860d91585a` |
| REQ-0075-03/05 | dirty source snapshot 预封 GA 全流水线：pack、白名单、隔离 clean install、CLI/exports/Schema、Docker、SBOM、Manifest | 35 个 package entries、0 forbidden；npm Digest `sha256:f32dc372…`、container Digest `sha256:0ec6ca78…`、SBOM Digest `sha256:8654b8b…`；最终唯一 Result Commit 的 GA Artifact 在 Commit 后由同一入口重建并保存在受管 release evidence |
| REQ-0075-04 | Git/GitHub/npm/container 的 Intent/Event/Reconcile 单元测试及真实远端只读探测 | 追加式 ledger 与冲突拒绝通过；GitHub CLI、npm、GHCR 当前缺少发布凭据，最终状态必须由 Commit 后 `publish-summary.json` 记录，不得声称公开成功 |
| REQ-0075-06 | W01～W09 Runtime、Result Commit、Archive 只读复核；W10 双 Runtime handoff 设计审查 | 前置 Task 均已归档；TASK-0075 与 TASK-0075R1 将绑定同一 Result Commit/Tree，非 canonical 提交事故保留在 Incident 中 |

## Failure-path evidence

- 相同发布 Intent 可重复对账；状态未变化时不追加重复 Event。
- 远端存在同版本不同 Commit/Digest 时进入 `CONFLICT` 并 fail closed。
- 缺少认证时进入 `BLOCKED_AUTH`；本地 tarball、image 或 Tag 不会被投影为 Registry 成功。
- W10 曾因 CLI 默认端口命中旧 Restate cluster；原 Invocation 保留，canonical Runtime 使用独立 `TASK-0075R1` handoff，不复用 Workflow key、不直接修改 Projection。

Result Commit 后产生的最终 GA Manifest、发布 Receipt、两个 Workflow Seal Receipt 和部署健康事实保存在受管 Runtime evidence 中，不反向改写封存提交。
