# TASK-0020 Verification

> 状态：Accepted

验收类型：持久化产品 Runtime + 普通本地 Git 仓库 + 真实 Codex 双 Session；Fake/Mock 不计入成功证据。

## 普通仓库真实闭环

在持续运行的 Restate 1.7.4 与 Board `http://127.0.0.1:3019` 上，通过产品 API 提交真实任务，仓库为 `/Users/xiaxu/service/moye-state-machine-fixture`，Runtime Worktree 位于独立的 `/Users/xiaxu/service/.moye-runtime/moye-live`。这条路径要求 Codex 同时写 Worktree 内容和仓库 Git common dir，不能依赖 macOS 临时目录的宽松权限。

- Task：`TASK-LIVE-20260822042423-1171489F`
- Runner：`CODEX_EXEC`，Codex CLI `0.146.0`
- Implementation Session：`01a027b6-7f29-71e3-877a-da2a68aa8d03`
- Agent Run：`agent-run:sha256:57024620307f10e7294905da372afd34fab3f3f32881556dd564923b7b2d4076`
- Review Session：`01a027b7-731d-7e60-8f14-5a4018f372bc`
- Review Run：`live-review-run:sha256:dab94ccb8e62b87b3056fdf4476ade3869c81b0d8c8ff81c25b2f4b259b8245d`
- Review：`PASSED`，Finding `0`
- Base Commit：`be9558763f83b097e491cf62e206460dae686e58`
- Result Commit：`675c9efc92bb01faea5b548275cfb4e91ce06922`
- Verification：`verification-binding:sha256:b8a51e3cc87a4a4a32b253ff1629abfece71081998aefbdeb742339b30a5fa7d`
- Merge Commit / Target Head：`ab9ab22352502a383f1b04a250facb95bfbe8e0b`
- Outcome：`SUCCEEDED`
- Archive：`ARCHIVED`
- Agent Event Stream：20/20 条完整加载；其中真实 `git commit` 输出包含 Result Commit `675c9ef`。

Event History 从连续 Runtime Event 派生，Projection 终点校验为 `VERIFIED`：

```text
01 START → CONTEXT
03 CONTEXT → WORKSPACE
05 WORKSPACE → IMPLEMENT
07 IMPLEMENT → VERIFY
09 VERIFY → REVIEW
11 REVIEW → MERGE
13 MERGE → DOCS
16 DOCS → CLOSED
17 CLOSED → ARCHIVING
18 ARCHIVING → ARCHIVED
```

执行证据共 9 个实例：6 个 StepAttempt（均为 Generation 1）、1 个 Implementation AgentRun、1 个独立 ReviewRun、1 个 Verification。状态机 Definition 另外展示未走过的 Repair、Failure 和 Archive Failure 合法边，但不把它们写入本次 History。

## 浏览器验收

使用真实 headed Playwright 打开 `http://127.0.0.1:3019` 并点击上述 Task，实际 DOM 已确认：

- 首页为只读审计面，没有 Web 创建表单；Archived 列显示 4 条持久化 Task，不再只有两条演示记录；
- 详情首先显示 Runtime State Machine，业务 `CLOSED`、Archive `ARCHIVED`、整体 `ARCHIVED`、Event 重建 `ARCHIVED`，并标记“Event / Projection 一致”；
- History 显示 10 条实际转换，Executions 显示 9 个执行实例及两个真实 Session；
- Agent Events 弹窗完整加载 20/20 条 JSONL，能看到文件修改、`git add`、真实 `git commit`、内容校验与最终回答；
- 失败任务卡片根据 `FAILED_TERMINAL` 显示“已失败”，不会再伪装成“已关闭”；待处置列同时容纳待归档与失败后续动作。

截图：`output/playwright/task-state-machine-ordinary-repo.png`。

## Live Acceptance

```bash
npm run acceptance:live
```

2026-08-22 重跑通过：

- Task：`TASK-LIVE-20260822042820-BDE846EC`
- Fake 请求：被产品入口拒绝，`fakeRejected: true`
- Implementation Session：`01a027ba-1610-73d3-ba4f-6db2c4857932`
- Review Session：`01a027ba-eeeb-7d12-8b75-aa0ed5d6ad29`
- Result Commit：`2d4111dbb2e8349b92590f3f939136ea9de8d00c`
- Verification：`verification-binding:sha256:1b6d14e68b949a0305f2a346fb94bb4838cfdab2fbc959bd66fb74c11e15c6ab`
- Merge Commit：`d32197e82fe7538f52e2e014f51cf07d3345b5be`
- Review：`PASSED`，Finding `0`
- Agent Event：22 条
- Outcome / Archive：`SUCCEEDED / ARCHIVED`

## 自动化回归

```bash
npm run check
# typecheck passed
# 27 test files / 151 tests passed
# documentation graph valid: 184 documents, 301 relations, 123 Markdown files

npm run test:e2e
# 5 test files / 14 tests passed（真实 Restate）
```

单元测试固定 Coding/通用 Task 的 Event→State 映射、非连续 Event 拒绝、Review→Repair→新 IMPLEMENT Generation、Codex `workspace-write + --add-dir <validated-git-common-dir>` argv 边界。E2E 固定成功、Verification 失败、Agent 未提交、未知结果恢复、Archive 恢复和通用 Task Trace。

## 真实失败路径与修复

持久化 Task `TASK-LIVE-20260822041153-F564220A` 和 `TASK-LIVE-20260822041535-949D5441` 真实暴露了普通受管 Worktree 的 Git common dir 位于沙箱外：Codex 能写文件，但 `git commit` 因 `index.lock: Operation not permitted` 失败。状态机停在 `IMPLEMENT → FAILED`，下游 Verify/Review/Merge 均未进入，没有伪造成功。

修复只把 `AgentRunRequest` 已解析、已验证的 `workspaceGitCommonDir` 通过 `--add-dir` 加入 Codex `workspace-write`，没有启用 `danger-full-access`。随后同一路径的 `TASK-LIVE-20260822042423-1171489F` 成功提交并完整归档，证明根因已闭环。

## 边界

本次证明的是当前 CodingTaskWorkflow：Context → Workspace → Implementation/Repair → Verification → independent Review → Merge → Docs → Closed → Archive。Architecture 中的多 Daemon、Lease/Fencing、完整 Core Spec Replan、远程 PR 与生产鉴权仍未实现，不能从这次验收外推为已经可用。
