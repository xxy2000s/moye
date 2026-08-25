# TASK-0065 Verification

> 状态：Accepted
> 验证日期：2026-08-25

## Requirement → Execution → Evidence

| Requirement | Execution | Evidence |
|---|---|---|
| REQ-0065-01 | 本轮真实 Codex 与 Claude Role Run，受管 Transcript 重读 | Codex `01a03ae1-7f4c-7bc0-affe-067f02482db9` / Manifest `sha256:b47cf7de…5148`；Claude `2c28cacf-461c-497b-93d1-f10fa55cc551` / Manifest `sha256:8c2ed625…ad6b` |
| REQ-0065-02 | 显式绑定 `SESSION_CAPTURE_RECOVERY` summary，重查 Trace 与七个 Role 四类 API | `TASK-RCV-20260825190550-01-SESSION-CAPTURE`，Projection `sha256:336259e3…0651`，Archive Receipt `sha256:06e26808…a83a` |
| REQ-0065-03 | LIVE-006 七个 enrichment 幂等 replay | source Projection 前后 `sha256:7e883797…673a4`，七个 Receipt、172 canonical Event |
| REQ-0065-04 | canonical 聚合报告 | [agent-session-product-acceptance-3000.json](./agent-session-product-acceptance-3000.json)，Digest `sha256:7a9e335a934849935c4a2802b8467e804e731dbbd7816433ee92ff93c1055854` |
| REQ-0065-05 | Playwright CLI，1440×1000 与 390×844 | `output/playwright/TASK-0065/`：画布、实时 COMPLETE、历史 PARTIAL/Sidecar、Prompt 筛选、Escape/focus 与 3000 截图 |
| REQ-0065-06 | 当前事实文档与 Finding/Backlog 收敛 | README、Architecture、CodeMap、Runbook、Milestone、Finding、BL-0069 与 Docs Impact |
| REQ-0065-07 | Repository Gates 与本地部署 | `npm run check`、`npm run test:e2e`、`npm run build`；`http://127.0.0.1:3000/tasks/TASK-RCV-20260825190550-01-SESSION-CAPTURE` |
| REQ-0065-08 | 唯一 Result Commit、Archive、M1 Tag | `SealedTaskWorkflow/TASK-0065` 与 annotated tag `moye-m1-agent-session-evidence-r1` |

## 浏览器事实

- Recovery Task 首页显示“完整闭环”、七个真实 Session、真实 Candidate/Merge 与已归档；画布为 Event/Projection 一致，Repair/Replan/Reconcile/Failed 明确标记“合法但本次未发生”。
- 实时 Capture 弹窗显示 `COMPLETE + 实时证据`，历史 LIVE-006 显示 `PARTIAL + 历史补全 Sidecar`；历史 Prompt 筛选后只保留 Provider 用户记录且展示真正 Role Prompt。
- Chatbot 保持 Prompt/Assistant/Tool Call/Tool Result/System/Error-stderr 六类筛选；Escape 关闭弹窗并把焦点还给来源按钮；390×844 保持单列可读。
- 首轮浏览器验收识别出 55832 仍运行补丁前进程，重启最新源码后 metadata 正确；这是部署漂移，未改写 Runtime，最终 3000 干净复核通过。

## 剩余限制

- Provider 未暴露或加密 reasoning 不能由 Transcript 恢复；
- 当前是本地受管 Artifact、无鉴权 PoC，不能暴露公网；生产鉴权、加密、Retention/Erasure、远端 Artifact Store 与多租户仍未实现；
- LIVE-006 无执行前 Prompt Envelope，因此只能保持 `PARTIAL + UNVERIFIED`；
- M1 不证明完整多 Daemon Lease/Fencing，也不包含远程 Git Provider/PR。

