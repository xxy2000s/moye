# TASK-0063 Verification

> 状态：Accepted

| Requirement | Test / Execution | Evidence | 结果 |
|---|---|---|---|
| REQ-0063-01 | Core v2 Role trigger 同时绑定 session/timeline/stderr/events；loader 首先读取 metadata，canonical renderer 不调用旧 `eventSpeaker/eventSummary` | 真实 W04 Architect 弹窗标题为 `Session Timeline`；旧流仅标为 `Execution Stream` | PASS |
| REQ-0063-02 | 浏览器逐项切换 Prompt/User、Assistant、Tool Call、Tool Result、System、Error/stderr | 真实计数 `1 / 5 / 2 / 2 / 18 / 1`，合计 29（28 Transcript + 1 stderr） | PASS |
| REQ-0063-03 | 检查 actor/origin/time/tool/call id、长内容 disclosure、Evidence/content disposition | Moye Prompt 与真实 `exec` call/result 均可读；1196 字符 Prompt 可完整展开 | PASS |
| REQ-0063-04 | 展开 Session Metadata | CODEX、COMPLETE、full、Provider Session、source/parser、四项 completeness、parent/child 均可读 | PASS |
| REQ-0063-05 | 独立 `/stderr` 合并为显式 Runtime stderr；raw 仅 descriptor | stderr 单独计数 1；Raw Metadata 只显示 Digest 与 115565 B，无下载跳转 | PASS |
| REQ-0063-06 | Playwright 中断 metadata GET，验证失败视图；恢复网络后点击重试 | 失败时 Context loading 不残留；同一 Session 恢复 `COMPLETE` 和 28/28，不触发 Agent | PASS |
| REQ-0063-07 | 真实 Chromium 1440×1000、390×844、长内容、Escape、焦点、reload、console | 两种视口通过；Escape 后 dialog closed、trigger `aria-expanded=false` 且获得焦点；正常流 console error=0 | PASS |

## 真实产品证据

- Runtime Task：`TASK-RCV-20260825190550-01-SESSION-CAPTURE`，`CLOSED + ARCHIVED + SUCCEEDED`；
- Workflow：`restate://CoreV2Workflow/TASK-RCV-20260825190550-01-SESSION-CAPTURE`；
- Attempt：`TASK-RCV-20260825190550-01-SESSION-CAPTURE.ARCHITECT.r1.g0`；
- Run：`sha256:1739586f83e83cc87a98efb081bdab7e569a7bcee8ef9d7b3bb8136fa91490e7`；
- Provider Session：`01a03a50-92a3-70e1-88ce-93619bab27e5`；
- Manifest：`sha256:4dec649e2383a0488c7762ecdddecdf6ccce380ef8aa4c43a65e38b6173ed0e4`；
- Receipt：`sha256:aa00cb728ce0362c3c14fff795e8fdaafe5190d773721bdbb0d511364e1ebd6e`；
- 结构化浏览器证据：`browser-acceptance.json`；截图 `browser-desktop.png` 与 `browser-narrow.png` 连同摘要随 Task package 归档。

## 自动化门禁

- `node --check public/app.js`：通过；
- Targeted：`tests/unit/board-server.test.ts`、`tests/unit/session-capture-effect.test.ts`，7 tests 通过；
- Unit：44 files / 260 tests 通过；
- `npm run check`、`npm run test:e2e`、Document Graph 与 Docs Impact 在 Result Commit 前再次执行。

## 剩余边界

TASK-0063 只改变只读 Board UX 和 metadata 输出，不实现鉴权、远程保留策略或历史补全。历史 LIVE-006 append-only enrichment 由 TASK-0064 完成；最终跨 Provider/故障/部署门禁由 TASK-0065 完成。旧 Workflow 没有 Session Evidence contract 时仍只显示明确标记的 Execution Stream，不冒充完整 Transcript。
