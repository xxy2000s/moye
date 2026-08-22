# TASK-0039 Verification

> 状态：Accepted

| Requirement | Evidence |
|---|---|
| REQ-0039-01 | `CoreV2Workflow/TASK-CORE-V2-LIVE-006` 返回 `CLOSED + ARCHIVED + SUCCEEDED`；Lifecycle 14 条 Event 从 Intake 重建到 Archive，Candidate 与 Merge 都是 `933edecc5ee9d6a88b6d8d1146d47289666aed87`。 |
| REQ-0039-02 | LIVE-006 保存 7 个真实 Codex Session：ARCHITECT、DESIGN_REVIEW、IMPLEMENTATION、DOCUMENTATION、TEST_PLAN、TEST_ASSESSMENT、FINAL_REVIEW；Board 节点和弹窗可读取每个 `events.jsonl`。 |
| REQ-0039-03 | Trusted Runner Manifest `sha256:4ac48e7aef0b44639e5edb457c779fce5c3ddce2dbf54a4d3a0f9803dd007158`、Verification Gate `sha256:2d89611d0a3ca9de361c45a65baaea1e618ace0ee391d1edb5916e12602bf62f`、Knowledge Disposition `sha256:47704525420ef2f202abd9eb99fdd18ab4a3fd7ea5872ab9f5e8bd93f8b5a904` 和 9 类 Artifact 同时存在。 |
| REQ-0039-04 | Lifecycle/unit/E2E 覆盖 REPAIR 下游失效、REPLAN Revision 失效、Intent-only UNKNOWN、token 拒绝和显式 NOT_APPLIED 恢复；Graph 固定展示 Repair/Replan/Reconcile/Failure/Archive 合法边。 |
| REQ-0039-05 | CLI `core-v2-start/status/reconcile` 接入 keyed Workflow；浏览器实际打开 `/tasks/TASK-CORE-V2-LIVE-005`，显示 17 节点、完整路径、节点 Inspector、确定性 Observer 与可筛选 Events 弹窗。 |
| REQ-0039-06 | 产品 Runner 为真实 Codex CLI；Git、npm test、Restate、HTTP Board 与 Playwright 都实际运行。LIVE-001 至 LIVE-004 保留四类真实失败，LIVE-005 验证浏览器展示，LIVE-006 验证最新 Core 实现成功闭环。 |

## 真实成功证据

- LIVE-006 Candidate 仓库 worktree clean，`npm test` 为 2 passed / 0 failed；Commit message 含 `Moye-Task: TASK-CORE-V2-LIVE-006` 与 `Moye-Generation: 0`；
- Board Trace：`traceKind=CORE_V2`、`nodes=17`、实际 History 12 条、Projection/Event `VERIFIED`；Implementation Event API 返回 17 条，覆盖 conversation/tool/tool_result/system/error；
- 浏览器验收：单任务为 `/tasks/<id>` 全屏路由，右上角返回项目；点击 Implementation 节点显示 Session、44.4s、PASS、Workflow Event 和控制面；弹窗显示 17/17 条及五类筛选，不出现 Event 下载跳转；
- 全量仓库门禁：`npm run check` 为 34 files / 190 tests，文档图谱 337 documents / 545 relations；`npm run test:e2e` 为 12 files / 28 tests；最终 Result Commit 见 Seal Runtime Receipt。

## Knowledge Disposition

`applied`：真实失败直接反馈到当前实现——结构化 Output 去除不受支持的 JSON Schema 关键字；Workflow 接管 Git checkpoint；Test Plan 在 Agent 意图与受信任 argv 之间增加确定性规范化；Core v2 节点预览复用安全 Event 读取链。没有自动升级 Accepted ADR。

## 剩余限制

PoC 仍不证明多 Daemon/Lease/Fencing、远程 PR/Merge、生产级权限/多租户和长期知识效果反馈；这些保持在既有 Backlog，不伪装成本次已完成能力。
