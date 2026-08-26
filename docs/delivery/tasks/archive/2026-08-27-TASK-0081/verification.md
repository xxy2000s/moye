# TASK-0081 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0081-01/02 | Board metadata + 真实 canonical 历史 Session 浏览器验收 | 主层显示 `AVAILABLE / COMPLETE / UNVERIFIED / NONE`；明确说明内容可读但历史 Prompt 强绑定不可追溯，不再把 raw `PARTIAL` 称为记录不完整 |
| REQ-0081-03/04 | 真实 Restate managed partial fixture + limitation matrix 既有 Domain 覆盖 | 缺失时间戳映射为 Content `PARTIAL` 和稳定 `DIMENSION_PARTIAL/timestamps` reason；`NOT_EXPOSED` 单列为 Provider 边界 |
| REQ-0081-05 | 真实 Restate unavailable/integrity E2E + UI 静态断言 | PENDING/Reconcile/Unavailable/Failed 文案分离；受管 normalized Artifact 篡改后 API 返回 422、`FAILED + ARTIFACT_INTEGRITY_FAILED` 与“不重跑 Agent”建议 |
| REQ-0081-06 | 浏览器展开高级诊断 + Execution Stream 降级入口断言 | raw `receiptState: PARTIAL`、`promptBinding: UNVERIFIED`、completeness、metrics、errors 与全部 Digest 保留在折叠区 |
| REQ-0081-07 | Playwright CLI 真实浏览器 1440×1000 / 390×844 | 四维状态、筛选、诊断展开、网络失败后重试同一 Evidence、Esc/焦点返回通过；390px dialog 337px 宽且 `bodyOverflowX=false`；全程只读 |

## Executions

- `npx vitest run tests/unit/board-server.test.ts tests/unit/session-evidence-semantics.test.ts tests/unit/session-capture-effect.test.ts`：3 files / 14 tests passed。
- `npx vitest run tests/e2e/transcript-enrichment-restate.test.ts`：真实临时 Restate + Board，1 file / 4 tests passed；覆盖 canonical historical、Claude managed partial、unavailable 与 Artifact integrity failure。
- `npm run check`：typecheck 通过，57 unit files / 315 tests passed；Document Graph 748 documents / 1149 relations valid。
- Playwright CLI：真实 canonical 历史 Artifact，经当前 Board source 只读验收 1440px/390px、筛选、诊断展开、网络错误与恢复、Esc 与焦点返回；临时 3032/55924 endpoint 已停止。
- `ruby scripts/docs_graph.rb validate`、`validate-impact` 与 `git diff --check`：Result Commit 前通过。

## Review

- UI 只消费版本化 `metadata.semantics`；缺少合同即 fail closed，不从 legacy raw 字段猜测主提示。
- Board error envelope 复用 Domain classifier；Artifact Digest 校验仍在 resolver 内先于展示，未放宽 allowlist。
- raw Receipt/Manifest 事实没有改写；展示层把 Availability、Content、Binding、Limitation 分离，不将 policy/provider omission 冒充数据丢失。
- 真实浏览器使用 canonical 历史 Artifact，未调用 Runtime 写接口；真实 partial 与完整性故障由临时真实 Restate E2E 证明。

Evidence：[browser-acceptance.json](./browser-acceptance.json)、[desktop](./session-historical-desktop.png)、[diagnostics](./session-historical-diagnostics.png)、[mobile](./session-historical-mobile.png)、[network error](./session-network-error.png)。
