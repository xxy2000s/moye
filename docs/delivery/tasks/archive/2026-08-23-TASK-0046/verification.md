# TASK-0046 Verification

> 状态：Accepted
> 验证日期：2026-08-23

## 证据范围

本 Task 修复只读 Board 与 Core v2 验收输入元数据，不创建伪造 Runtime Task，也不修改 ProjectBoard Projection。产品级浏览器验收使用持久化 Restate `moye` ProjectBoard 的 57 个真实归档 Task，以及 `TASK-GRD-20260823152633-03-OBSERVER-TIMEOUT` 的真实 Codex Role Event Artifact。单元测试与隔离 Restate E2E 分别作为领域/API 和恢复协议补充证据，不冒充新的真实 Agent 故障场景。

## Requirement → Test → Evidence

| Requirement | 执行 | Evidence | 结果 |
|---|---|---|---|
| REQ-0046-01/02 | 查询 `http://127.0.0.1:3024/api/board`；核对 LIVE-001～006 与最新成功 Task | Board 响应摘要 `sha256:d4cecbeb9d29d04308c6023437d70cdcbf4fdf16f109bfd74f8f993fc7e88b5f`；六个 LIVE Task 均为 `CORE_V2 + PRODUCT_ACCEPTANCE + ARCHIVED`，001～004 保留 `FAILED_TERMINAL` | PASS：精确 outcome/runtime/archive 分离，Authority 只读丰富，无 Projection 写入 |
| REQ-0046-03/04 | 真实浏览器核对最新成功入口及 outcome/workflow/history 三个筛选器 | 最新成功为 `TASK-GRD-20260823152633-03-OBSERVER-TIMEOUT`；历史筛选覆盖 57 个持久化归档 Task；桌面截图 `output/playwright/task-0046-board-desktop.png`，390px 截图 `task-0046-board-mobile.png` | PASS |
| REQ-0046-05 | 打开成功 Task 的完整 Graph，点击未经过 Repair 节点 | Trace 摘要 `sha256:9224982f95da275e443ea8a26f7d15a5c1cdcb9fb5683af3c8a9316dfa17b3b5`；History 13 条且一致性 `VERIFIED`；Repair Inspector 显示 0 Agent/0 状态记录/0 执行实例和“合法但本次未发生” | PASS：未把合法边伪装为实际失败 |
| REQ-0046-06 | 在同一 Task 页面点击 Architect 的 Agent Events | Session `01a02f42-cd44-73d1-bd7f-a90c8de0d897`；Event 响应 `sha256:53134e63b798a90e91a0b2488963f4dad06ae2eb682c4946f55f42049117e600`；9/9 条，分类为对话 1、工具调用 2、工具结果 2、系统 3、错误 1 | PASS：事件在 `<dialog>` 加载并筛选，没有下载跳转 |
| REQ-0046-07 | `npm run check` | TypeScript、36 个单元测试文件 / 216 tests、文档图 430 documents / 660 relations | PASS |
| REQ-0046-07 | `npm run test:e2e` | 12 个隔离 Restate E2E 文件 / 31 tests；首次运行发现并修复 BL-0050 枚举及两处旧 Board 断言后全量重跑 | PASS |

## 浏览器布局与可访问性

- 桌面总览、节点 Inspector、390×844 总览和 Task Detail 均完成真实浏览器截图与视觉检查；
- 最新成功入口、三个 select、Task 卡片、Graph 节点、返回按钮和 Event 分类均可由可访问名称定位；
- 浏览器控制台为 0 error / 0 warning；
- 历史外部 Artifact Root 不在当前 allowlist 时 API 仍返回 404；本次使用受管 `.moye-runtime` 中的最新真实 Task 证明事件弹窗可实际加载，该安全边界未放宽。

## 剩余边界

本 Task 只完成 Board 语义与浏览器审计，不证明用户要求的统一真实故障矩阵已经全量重跑。跨场景证据完整性、重复执行审计与最终 3000 端口部署由 TASK-0047/0048 继续完成。
