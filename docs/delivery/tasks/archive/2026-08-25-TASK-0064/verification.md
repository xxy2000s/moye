# TASK-0064 Verification

> 状态：Accepted
> 验证日期：2026-08-25

## Requirement → Execution → Evidence

| Requirement | Execution | Evidence |
|---|---|---|
| REQ-0064-01/02/05 | `TranscriptEnrichmentWorkflow` 从 `TaskAuthority` 读取 owning archived Core v2 Projection，冻结并复核 Historical Baseline | 真实 LIVE-006 source Projection 前后均为 `sha256:7e883797e7d08c25ba0acc1fb4d699940334b32cd7f0d55e7013efe831a673a4` |
| REQ-0064-03/07 | Provider Adapter 受 `MOYE_SESSION_SOURCE_ROOTS` 与 Artifact allowlist 约束；缺源形成 `UNAVAILABLE` Receipt | `transcript-enrichment-restate.test.ts` 的真实 Restate 缺源与越界 root 场景；`session-capture-effect.test.ts` 的 managed Artifact 复用 |
| REQ-0064-04 | `SessionEvidenceRegistry/<run-id>` 以 Authority Version claim/record，保存 append-only Attempt/Receipt 链 | 真实 Restate 重放历史长度保持 1；不同 enrichment successor 被拒绝且 head Receipt 不变 |
| REQ-0064-06 | Board 没有 live record 时按精确 `runId` 查询 Registry，沿用 `/session|timeline|events|stderr` | LIVE-006 7 个 Role 的四类 API 全部通过；共 172 canonical Provider Event，原 Execution Stream 与 stderr 独立可读 |
| REQ-0064-08 | `npm run acceptance:agent-sessions:history` 附着真实 LIVE-006 七个 Codex Session | [session-history-acceptance.json](./session-history-acceptance.json)，报告 Digest `sha256:abba2838f92b1e73b4ef31951410ff8cf6109b22b168a288cba9e29295096cc3` |
| REQ-0064-09 | 无手工点击入口、全库门禁与文档门禁 | `npm run check`、`npm run test:e2e`、Document Graph/Docs Impact Gate |

## LIVE-006 真实结果

- Architect：Session `01a02b11-8719-7d20-8a2d-18e3bc33d28f`，23 canonical Event，Receipt `sha256:a204d02b…58d09`；
- Design Review：Session `01a02b12-6fd5-7b52-9e6a-3c662e07344e`，19 Event，Receipt `sha256:37bdd6a8…63974`；
- Implementation：Session `01a02b12-d91d-7501-87e8-2720b6a83971`，32 Event，Receipt `sha256:51e3416b…4587a`；
- Documentation：Session `01a02b13-6fca-79c3-a7b4-7d9098162b36`，39 Event，Receipt `sha256:d87748f9…d0f19`；
- Test Plan：Session `01a02b14-4676-7123-9f1d-e1e2487ada36`，14 Event，Receipt `sha256:faa663fe…bf6f1`；
- Test Assessment：Session `01a02b14-800c-71f0-9f43-946ecfdd4293`，14 Event，Receipt `sha256:5e762c3f…e836c`；
- Final Review：Session `01a02b14-c3c6-7171-beb9-04b13de13f39`，31 Event，Receipt `sha256:a96fa1d9…7e5e1`。

七个 Receipt 均为 `PARTIAL + UNVERIFIED`，不是 Capture 失败：Provider 原始 user Prompt、Assistant、Tool 与 System 内容已经完整受管保存，但遗留 Task 没有执行前 `PromptEnvelopeV1`，因此不能升级成 `COMPLETE` 或伪称强绑定。首版也主动拒绝调用方提交 `PROVIDER_NATIVE_OBSERVED`，直到 Workflow 能独立从受管 execution intent 与 Provider record 推导全部 Legacy Evidence。

## 自动化证据

- `npm run check`：44 个 unit test 文件、261 个测试通过；TypeScript 与 Document Graph 通过；
- `npm run test:e2e`：13 个文件、35 个测试通过，2 个显式真实模型开关测试跳过；新增 Restate enrichment 文件独立通过；
- `npm run acceptance:agent-sessions:history`：七个真实 Codex Session 7/7 Receipt、7/7 Board API、7/7 幂等 replay，通过；
- `git diff --check`：通过。

## 剩余限制

- Provider 加密/未暴露 reasoning 仍不可能从原生日志恢复；
- 历史 Prompt 目前只允许 `UNVERIFIED`；Provider-native exact binding verifier 留给后续生产增强；
- Registry 已有 version fencing，但跨多 Daemon 的通用 Lease 管理不属于本 Task；
- 生产鉴权、加密、Retention/Erasure policy 与远端 Artifact Store 仍由后续发布/生产化 Milestone 处理。
