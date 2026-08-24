# TASK-0053 Verification

> 状态：Accepted

## Requirement → Evidence

| Requirement | 验证 | 结果 |
|---|---|---|
| REQ-0053-01 | 真实 `TASK-0052` 默认画布在四 Tab 后直接显示路径筛选、Graph 与一致性标识；页面不再存在 `task-workspace-summary` 或 `Runtime State Machine` 常驻标题 | 通过 |
| REQ-0053-02 | 一致 Task 只显示 `Event / Projection 一致`；代码契约确认 mismatch 时渲染 `role=alert` 与四项差异 | 通过 |
| REQ-0053-03 | Playwright 切换“Workflow 状态事实”后核对 `CLOSED / ARCHIVED / ARCHIVED / ARCHIVED` 四项事实和 7 条 Domain Event | 通过 |
| REQ-0053-04 | `TASK-0052` SVG 只含 BUSINESS 与 ARCHIVE 分区，不再含黄色 Recovery 背景；Core v2 保留紧凑 `575×145` Recovery，Coding 使用独立紧凑节点簇 | 通过 |
| REQ-0053-05 | `TASK-0052` Header 显示真实 `SealedTaskWorkflow` 与 `无 Agent Session`；Core v2 Happy Task 显示 7 个真实 Session | 通过 |
| REQ-0053-06 | 定向测试、完整 check、完整 E2E、桌面/窄屏浏览器与 Docs Gate | 通过 |

## 自动化证据

- `node --check public/app.js`：通过；
- `npx vitest run tests/unit/board-server.test.ts`：1 个文件、6 个测试通过；
- `npm run check`：typecheck、39 个测试文件 / 225 个测试、Document Graph 全通过；
- `npm run test:e2e`：12 个文件 / 31 个测试通过；
- 首次 E2E 正确发现旧测试仍要求重复标题 `Runtime State Machine`，更新为新信息层级契约后完整重跑通过；
- `git diff --check`：通过。

## 真实浏览器证据

- 基础 Task：`http://127.0.0.1:3000/tasks/TASK-0052`；
- Core v2：`http://127.0.0.1:3000/tasks/TASK-ACCEPT-20260823175744-01-HAPPY`；
- 桌面：1440×1000，核对 Header、默认 Graph、无黄色 Recovery 空场、Workflow 状态事实；
- 窄屏：390×844，核对 Tab、横向画布、紧凑工具栏与 44px 控件；
- Core v2 保留 19 节点、52 条合法边、13 条实际路径与 7 个真实 Role Session。

## 事实边界

本任务没有修改 Board Projection、Workflow、状态机 Definition 或 Event History。信息折叠、异常差异提示、Workflow 标签和 SVG 几何全部是浏览器只读呈现。
