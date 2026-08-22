# TASK-0021 Verification

> 状态：Accepted

验收只把真实 `CODEX_EXEC` 产品 Task 作为成功或真实 Finding 证据；Fake/Mock 仅用于中断、Repair、Reconcile 等确定性回归，不计入产品成功证明。

## 1. 持久化 Web 成功闭环

在持续运行的 Restate 1.7.4、Moye Service 与 `http://127.0.0.1:3019` Board 上，通过统一 CLI 提交普通本地 Git 仓库 `/tmp/moye-web-acceptance`：

```bash
npm run cli -- create --file /tmp/moye-web-task.json
npm run cli -- wait TASK-LIVE-WEB-CLOSURE-20260822 --timeout-ms 720000
```

- Task：`TASK-LIVE-WEB-CLOSURE-20260822`
- Invocation：`inv_1hfTZj6ffEi6766zHmsm8uBYmLUZc9qUnW`
- Runner：`CODEX_EXEC`，Codex CLI `0.146.0`
- Context Session：`01a027f6-2fea-7760-8f5a-8f809eab1069`，`PASSED`
- Implementation Session：`01a027f7-2690-7472-88eb-3623fdbfaee9`
- Self Review Session：`01a027f8-0fd7-7c71-b186-52145d484a17`，`PASSED`
- Independent Review Session：`01a027f9-0f38-7922-9593-61fa5f236d30`，`PASSED`
- Docs Gate Session：`01a027f9-fda2-7fb3-b6ca-d57f4265c600`，`PASSED`
- Result Commit：`d22535a974005ffaec7ec675fb74e13f009f4774`
- Verification：`verification-binding:sha256:a1286a354e785524b11444961536d29ad967482ae4c11be85a8593c62858e3b6`
- Merge Commit / Target Head：`ca93aef3a8f2d9a03aaa5ff5a0d3103c79df957b`
- Outcome / Archive：`SUCCEEDED / ARCHIVED`
- Archive：`/tmp/moye-live-runtime/tasks/archive/2026-08-22-TASK-LIVE-WEB-CLOSURE-20260822`

Event-derived 状态机终点为 `CLOSED / ARCHIVED / VERIFIED`，实际路径 11 条：

```text
01 START → CONTEXT
03 CONTEXT → WORKSPACE
05 WORKSPACE → IMPLEMENT
07 IMPLEMENT → SELF_REVIEW
09 SELF_REVIEW → VERIFY
11 VERIFY → REVIEW
13 REVIEW → MERGE
15 MERGE → DOCS
18 DOCS → CLOSED
19 CLOSED → ARCHIVING
20 ARCHIVING → ARCHIVED
```

页面列出 6 个 Step Attempt、1 个 Implementation Agent Run、3 个 Live Role Run、1 个 Independent Review Run 和 1 个 Verification，共 12 个执行实例；未走过的 Repair、Replan、Waiting Reconcile 和 Failure 边只出现在 Definition，不伪造到 History。

## 2. 浏览器全程验收与实时刷新修复

使用 headed Playwright 在任务刚进入 `CONTEXT` 时打开同一个详情弹窗，确认 RECEIVED/运行态、Attempt G1、状态机合法边和当时的实际 History。任务结束后，Board 已进入 Archived，但详情仍显示首次快照；这暴露了真实的打开详情不刷新缺陷。

修复后 Board 的五秒轮询同时刷新打开 Task 的 Trace，仅在事实签名变化时重绘并保留滚动位置；原始事件 Viewer 打开时暂停详情重绘，避免丢失 cursor。终态 DOM 再次确认：

- 任务结论“任务已闭环”，业务 `CLOSED`、Archive `ARCHIVED`；
- Event / Projection 一致，11 条实际转换和 12 个执行实例；
- 10 个 Journey 阶段中 Replan 因未发生保持“未开始”，其余阶段均按事实完成；
- 5 个真实 Session 显示 Role、Revision、Attempt、Verdict、摘要和原始 Events 链接；
- 从 Context 链接实际下载 11 行 JSONL，SHA-256 为 `853b6bc08719a41a859e9a4ab27b59177840083315032ce8fe9898a706e5e8b5`，与 Projection 的 `eventsContentDigest` 完全一致。

补齐全角色流式 Locator 后，又提交 `TASK-LIVE-ROLE-STREAM-3-20260822` 并在 Context 尚未结束时打开页面：角色区立即显示 `CONTEXT / R1 / #1 / RUNNING`，事件 Viewer 显示 `CONTEXT-1 · Codex CLI` 和“实时跟随中”；首次快照已增量读取 5 条真实事件，包括 `thread.started` Session `01a0280e-3319-7642-bd92-28a202ef38ba`、命令调用和命令结果。期间实际发现并修复预计算 Run ID 被 Runner 二次摘要导致 Locator 与 Artifact 目录漂移的问题；canonicalization 现已由单元测试固定为幂等。

截图：

- `output/playwright/task-live-received.png`
- `output/playwright/task-live-archived.png`
- `output/playwright/task-live-role-stream.png`

## 3. 真实 Finding、Spec Revision 与失败归档

为证明 Replan 不是测试 Adapter 或页面占位，通过统一 CLI 提交含一条明确未定义强制要求的真实 Task：`TASK-LIVE-REAL-REPLAN-20260822`。

- R1 Context Session：`01a02800-0774-7642-8d53-6ada0103c4fd`
- Verdict：`FINDINGS`
- Blocking Finding：`Mandatory product requirement is unspecified`、`Validation is not anchored to the base commit`
- Recommended Action：均为 `REPLAN`
- Event：`SPEC_REVISED`，Envelope 从 R1 提升为 R2，Digest `sha256:2f8fbd29b9d8ddc955e511eb90db66d255504bb28648dc3878b964ecd3d7e5b8`
- R2 Context Session：`01a02801-64f3-75c3-9cf2-a7914ef133da`
- 结果：真实缺失的产品要求仍未由 Task Owner 补足，第二次 Context 拒绝实现；Workflow 在 Replan 预算耗尽后形成 `FAILED_TERMINAL` 并独立 `ARCHIVED`
- Archive：`/tmp/moye-live-runtime/tasks/archive/2026-08-22-TASK-LIVE-REAL-REPLAN-20260822`

这条失败闭环证明新 Revision 会失效旧 Context Attempt、Attempt Generation 连续提升，并且模型不会在规格仍不可执行时被强迫进入 Worktree/Implementation。

## 4. Live Product Acceptance

```bash
npm run acceptance:live
```

真实 Codex 多 Session 验收通过：

- Task：`TASK-LIVE-20260822052720-42AD3B14`
- Fake 产品请求：被拒绝，`fakeRejected: true`
- Context：`01a027f0-176e-7f83-a756-80fb3bf000b5`
- Implementation：`01a027f1-0f51-7762-8213-7cdd92c9dc0f`
- Self Review：`01a027f2-02d5-7f52-a983-ac3c927cd21e`
- Independent Review：`01a027f2-b91b-7512-9f0a-8177efdd4911`
- Docs Gate：`01a027f4-0633-7373-a87b-8e7f47369adc`
- Result Commit：`68ac35c4a20f7a6c12cca91bb307d8c8830d15d5`
- Verification：`verification-binding:sha256:2054cf162a6d1e9ec45cf7164d47924d8657f51e62aa7beb66f5b6f8b2cf03a4`
- Merge Commit：`03356c7d317a07a9f0ba14c21b3bdf03d821dbc7`
- Outcome / Archive：`SUCCEEDED / ARCHIVED`

更早的真实 Task `TASK-LIVE-20260822052435-FF84F113` 被 Context Session `01a027ed-91e8-70a1-93e0-27a9e1959a7d` 正确拒绝并归档，因为最初 Validation Command 不能证明 Git 提交边界；修正验收命令后才得到上述成功结果，没有掩盖失败。

## 5. 自动化与故障矩阵

```bash
npm run check
# typecheck passed
# 28 test files / 155 tests passed
# documentation graph valid: 191 documents, 313 relations, 127 Markdown files

npm run test:e2e
# 5 test files / 14 tests passed（真实 Restate）
```

自动化覆盖成功、Review Finding → Repair Generation N+1、Review Finding → Replan R2、Verification 失败后失败归档、Agent 未提交、重复提交/Authority、Archive 独立恢复、UNKNOWN → `WAITING_RECONCILE` → durable signal → 同一 operation 对账恢复，以及旧 Attempt/旧 Revision 不能覆盖新结果。产品构造只接受 `CODEX_EXEC | CLAUDE_PRINT`；Fake 只存在于隔离单元/E2E fixture。

## 6. 当前边界

本任务补齐的是单个真实本地研发 Task 的完整可用闭环和 Web 审计面。仍未实现多 Daemon Lease/Fencing、远程 Git Provider/PR、身份鉴权、多租户、人工冲突编辑器、Metrics/Logs/告警/SLO 和跨设备 Artifact 迁移；这些不能从本次验收外推为已具备。
