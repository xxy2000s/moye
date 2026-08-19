# TASK-0006 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）

## 验收映射

| Requirement | 证据 | 结果 |
|---|---|---|
| REQ-0006-01 | 六个领域 Step 均生成 `StepAttempt + AttemptEvidence + EvidenceBinding`；TaskAuthority 拒绝双 Workflow 主权；Coding Projection 同步只读 ProjectBoard | 通过 |
| REQ-0006-02 | argv/shell=false、严格 Evidence 解析、稳定 Verification Operation、完成结果复用与 pending→`RESULT_UNKNOWN` 停止；失败 master 保持 Base | 通过 |
| REQ-0006-03 | Binding-only Merge Request、确定性 Merge Commit、`update-ref <target> <new> <expected>` 原子 CAS、marker/双亲/ancestry 对账；并发 Base drift 不会写入未授权 Merge | 通过 |
| REQ-0006-04 | Docs Artifact 是必经 Step；只有全证据齐全进入 CLOSED；Restate 路径随后调用独立 ArchiveWorkflow，Archive 失败不重开编码 | 通过 |
| REQ-0006-05 | Fake 真实 Restate E2E 覆盖成功、Gate 失败、Merge 丢回执和 Worker 重启交接；真实 Codex Fixture 形成 Session→Commit→Verification→唯一 Merge 全链证据 | 通过 |

## 自动化证据

- `npm test`：70/70 单元测试通过。
- `npm run test:e2e`：7/7 真实 Restate E2E 通过，其中 Coding Workflow 4 项。
- `npm run typecheck`、文档图和 `git diff --check`：通过。

故障证据包括：Verification Activity 执行命令后强杀 Worker，新 Worker 从同一 Journal 重放；稳定 Intent 已存在但无 Outcome 时返回 `RESULT_UNKNOWN`，命令计数仍为 1，Target master 保持 Base。Merge E2E 在原子 ref 更新成功后模拟丢失 Git ref 更新回执，最终只存在一个带 Effect marker 的 Merge Commit。

## 真实 Codex Fixture v2（当前实现）

- Codex：`codex-cli 0.146.0`；Session：`01a01b5b-f2fd-7c00-af1a-92ef71324cf6`。
- Agent Run Digest：`agent-result:sha256:5814a8d6b3136687cb307f861f912cdb3b0df9d973be9eef7a186747238b3098`；稳定 execution intent 已保存。
- Result Commit：`e5a76a1db96ac24ccd310076e4f8e8da58db529e`；Tree：`920890009af28b972090e0826adda6817b187cd4`。
- Verification Digest：`verification-binding:sha256:a9c92c564c00ef2c3b7639d8de01e0341098b27fbd6dd32c3b59a4a516aa65a2`；稳定 Verification intent/outcome 均已保存。
- Merge Commit：`279d7d144b263da8f08e2f5d8cd63019b5f3bc23`；detached integration repo 的 master 与其一致；Effect marker 数量为 1。
- Projection 含 6 个成功 Attempt 和 6 个 Evidence Binding；Archive Receipt 已保存，`archiveStatus=ARCHIVED`。
- 原始 JSONL、stderr、final message、manifest、Intent/Outcome、Verification、Docs、Archive 与摘要位于 `evidence/codex-smoke-v2/`；一次性 Fixture 已删除。

`evidence/codex-smoke/` 保留为修复前 v1 历史证据，不用于证明当前实现。

## 独立复审

第二轮只读复审结论为 `RELEASE READY`，无 blocker / major。复审逐项确认原子 CAS、Verification/Codex 未知结果停止、单一 TaskAuthority、Step/Attempt/Evidence Projection、独立 ArchiveWorkflow、Worker 重启交接以及 v2 真实 Codex 证据。

## 当前限制

- ProjectBoard 已包含 Coding Task 的主状态、归档状态和事件摘要；Attempt/Evidence/领域 Event、Restate Journal 与日志的分层详细 Trace UI 仍由 TASK-0007 完成。
- 没有 Lease/Fencing、Repair/Replan、远程 Git 或 PR；这些保持 Backlog，不在本 Task 扩张。
