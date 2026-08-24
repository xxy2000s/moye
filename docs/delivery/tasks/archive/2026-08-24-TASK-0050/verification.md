# TASK-0050 Verification

> 状态：Accepted
> 验证日期：2026-08-24

## 结论

Core v2 Task Audit 已从“完整定义平铺”调整为“实际执行路径优先、完整定义按需核对”。真实归档任务 `TASK-ACCEPT-20260823175744-01-HAPPY` 的 19 个状态、52 条合法转换、13 条实际转换和 7 个真实 Role Session 均由既有 Trace API 只读呈现；本任务没有新增状态推进接口，也没有改写 Runtime Projection 或 Event History。

Implementation 节点首屏可见 Agent Session 和 Chatbot Events；Verification Gate 等无 Session 节点明确标记为系统节点，并显示 Candidate、Gate Digest 与实际路径。Domain Event 默认显示业务摘要、转换、类型、时间和 sequence，原始 detail 改为逐事件 disclosure；合法路径按实际经过优先，并保留 direction、kind、sequence 和说明。

## Requirement → Test → Evidence

| Requirement | Test / Execution | Evidence |
|---|---|---|
| REQ-0050-01/02 | 真实 Task Graph 桌面审计；`board-server.test.ts` 静态契约 | 默认 `ACTUAL`；主流程、Recovery、Failure、Archive 紧凑分带；完整 Definition 仍保留 19 状态 / 52 转换 |
| REQ-0050-03 | 选择真实 `IMPLEMENTATION` 节点 | 首屏显示 Attempt、Session、最近 Agent Events、Candidate Commit、Checkpoint、Tree、Self Review 与本次路径；Session `01a02fc6-321d-7283-8712-c0a47de55748` 可追踪 |
| REQ-0050-04 | 选择真实 `VERIFICATION_GATE` 节点 | 明确显示“由 Workflow 系统执行”，并展示 Spec Revision、Candidate Commit、Gate Digest 与状态记录，不伪造 Agent Session |
| REQ-0050-05 | 展开真实 Domain Event 时间线 | 默认层显示业务摘要与 route；原始 Detail 逐条折叠、转义并保持只读 |
| REQ-0050-06 | 展开合法进入与离开路径 | 实际边置顶，显示“实际 / 进入 / 离开”、sequence、kind 与完整说明；长 transition ID 在窄屏纵向排布 |
| REQ-0050-07 | 打开 Implementation 的 Agent Events Dialog 并切换“工具结果” | Events 保持页面内 Chatbot 弹窗；真实 Session 可筛出 6 条 tool result，不触发下载或新窗口 |
| REQ-0050-08 | 1280×800 与 390×844 浏览器回归；鼠标选择、关闭按钮与 Escape | 桌面右侧 Inspector、移动 Bottom Sheet、Graph 横向审计和键盘关闭均可用；交互继续只读 |
| REQ-0050-09 | 定向单测、完整 check/E2E、Graph/Impact Gate、Sealed Workflow | `tests/unit/board-server.test.ts` 6 tests；`npm run check` 39 files / 225 tests；`npm run test:e2e` 通过；Result Commit 后由 Runtime 写入最终 Receipt |

## 本地视觉证据

真实页面截图保存在未纳入 Git 的 `.moye-runtime/ui-audit/TASK-0050/`，包括 Graph 总览、Implementation Inspector、Agent Events 全量及工具结果筛选、Verification Gate、Domain Events、合法路径和移动 Bottom Sheet。截图只作为可复核的运行证据，不替代 Runtime Task、Session、Event 和 Artifact。

## 证据边界

本任务只改变 Board 的只读投影展示，不重新执行 Core v2 Agent 矩阵。状态机与真实 Agent 产品验收能力仍由既有归档 Task 和 Runtime Receipt 证明；完整多 Daemon Lease/Fencing、远程 Git Provider/PR、鉴权、多租户、生产 Sandbox/密钥治理、跨节点 Artifact Store、生产 Metrics/Logs/告警/SLO 仍不在本次前端修复范围。

Result Commit SHA、Package Digest 和最终 `CLOSED + SUCCEEDED + ARCHIVED` Receipt 只能在本 Commit 产生后由 Runtime 写入，不能回写本文件形成自引用。
