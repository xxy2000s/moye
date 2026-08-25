# TASK-0062 Verification

> 状态：Accepted

| Requirement | Test / Execution | Evidence | 结果 |
|---|---|---|---|
| REQ-0062-01 | `session-capture-effect.test.ts` 从 Provider Adapter 受管 Artifact 读取 `NormalizedTimelineEventV1`，并验证分页后的 canonical Event 完整拼接 | 不调用 `classifyAgentEvent`；真实 API 返回 PROMPT/ASSISTANT/TOOL_CALL/TOOL_RESULT/SYSTEM | PASS |
| REQ-0062-02 | 新 `/session`、`/timeline`、`/stderr`；既有 `/events` 回归与真实读取 | 真实同一 Role：Timeline 28 条 canonical events；execution stream 9 条且保持 raw；stderr 独立 Digest | PASS |
| REQ-0062-03 | Unit 验证 2 条分页续读；真实入口对 7 个 Role 以 limit=7 遍历并检查 cursor/Event ID 无重复 | 7 Role 合计 247 条 normalized events，无丢失或重复 | PASS |
| REQ-0062-04 | Unit 验证 PENDING metadata 与 409；真实 API 验证非法 cursor 返回 `SESSION_CURSOR_INVALID/400` | Resolver 定义 PENDING、WAITING_RECONCILE、UNAVAILABLE、FAILED、FORBIDDEN 与 INTEGRITY 机器码 | PASS |
| REQ-0062-05 | allowlist/realpath containment + managed inspect；真实验收只配置 W04 Moye acceptance root | API 不接受 path/Provider Home 参数，session metadata 的 raw 仅为 descriptor | PASS |
| REQ-0062-06 | Locator/Authority/Receipt parser、Task/Attempt/Run/Role Manifest binding、Adapter raw/normalized/Manifest Digest、Role stderr Digest | Provider Adapter 篡改/越界测试与 Board resolver 组合通过 | PASS |
| REQ-0062-07 | `npm run acceptance:core-v2:session-api` 附着真实 W04 Task 并逐 Role 读取 | 真实 Task/Session/Manifest 见 `real-api-acceptance.json` | PASS |

## 真实产品证据

- Runtime Task：`TASK-RCV-20260825190550-01-SESSION-CAPTURE`；
- Workflow：`restate://CoreV2Workflow/TASK-RCV-20260825190550-01-SESSION-CAPTURE`；
- Runtime 终态：`CLOSED + ARCHIVED + SUCCEEDED`；
- 读取角色：7/7 个真实 Codex Role；Session ID、Attempt ID、Run ID、Manifest Digest、stderr Digest 逐项保存在 `real-api-acceptance.json`；
- normalized events：247 条；每个 Role 均含 1 条完整 Prompt Evidence；
- Evidence Report SHA-256：`sha256:601b9c696a959fb3896bb94890a526ba5f976da35d61ce229a8d4961d2ac5dbc`；
- 验收入口只调用 Trace/Session/Timeline/Events/stderr GET API，没有提交 Workflow、运行 Agent/Test、创建 Commit/Merge 或扫描目录。

## 自动化门禁

- Targeted：`tests/unit/session-capture-effect.test.ts`、`tests/unit/board-server.test.ts`，7 tests 通过；
- Unit：44 files / 260 tests 通过；
- E2E：`npm run test:e2e` 通过；
- Product：`MOYE_SESSION_API_ACCEPTANCE_TASK=TASK-RCV-20260825190550-01-SESSION-CAPTURE npm run acceptance:core-v2:session-api`，7/7 Role 通过；
- `npm run check`、Document Graph 与 Docs Impact 由 Result Commit 前最终门禁确认。

## 剩余边界

W05 只交付 API/证据读取层。现有浏览器弹窗仍消费 execution stream；切换为 canonical Timeline、展示完整性/来源/stderr、筛选和响应式交互由 TASK-0063 完成。历史 LIVE-006 enrichment 由 TASK-0064 完成。
