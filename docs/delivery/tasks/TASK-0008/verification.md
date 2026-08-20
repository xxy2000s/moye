# TASK-0008 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal Bootstrap `/root`

## 验收映射

| Requirement | 证据 | 结果 |
|---|---|---|
| REQ-0008-01 | `scripts/demo.ts` 在隔离 Git Fixture 中提交 `CodingTaskWorkflow`；Fake Agent 产生 Session、Result Commit、Verification、唯一 Merge 与 Archive；成功后 Worktree 已清理 | 通过 |
| REQ-0008-02 | Moye Board 默认展示任务结论、关联链和中文七阶段旅程；每阶段可展开 Attempt/Evidence | 通过 |
| REQ-0008-03 | Trace 返回 Workflow service/key；Restate 深链携带 `CodingTaskWorkflow + task_id` 过滤；Journal/Artifact 位于“高级诊断” | 通过 |
| REQ-0008-04 | Task 卡为原生 Button，阶段和高级区为原生 Details/Summary；焦点、44px 目标、文字+符号状态与响应式布局通过 Chromium 验收 | 通过 |
| REQ-0008-05 | 单元、真实 Restate E2E、桌面/移动浏览器、README/Architecture/CodeMap/Runbook/Docs Impact 全部完成 | 通过 |

## 自动化证据

- `npm run check`：TypeScript、84/84 单元测试和文档图全部通过；
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0008/docs-impact.yaml`：30 项必读与 11 项影响复审全部通过；
- `npm run test:e2e`：4 个测试文件、10/10 真实 Restate E2E 通过；
- 新增 Demo E2E 从脚本启动独立 Restate 与 Moye，确认 `CLOSED + ARCHIVED`、6 个 Attempt、Fake Agent Session、Verification、Result/Merge Commit、过滤后的 Restate URL，以及成功后的 Worktree 清理；
- Backlog E2E 的可见项断言改为从当前文档状态派生，`CONVERTED_TO_TASK` 条目不再被陈旧 ID 列表误判为应显示；
- `node --check public/app.js` 通过。

## 真实 Demo 与浏览器证据

真实 Demo `TASK-DEMO-MT1NVGIR` 在 Restate 1.7.4 中闭环，绑定：

- Agent Session：`agent-session-TASK-DEMO-MT1NVGIR`；
- Result Commit：`e25383a25c739185e477b287df6fa2a842ec0136`；
- Merge Commit：`ec4b79727381edd311420e37ebdc9bc8391e5dd0`；
- 6 个 Coding Attempt 和独立 Archive 回执；
- 过滤到 `CodingTaskWorkflow/TASK-DEMO-MT1NVGIR` 的 Restate Invocations 深链。

使用真实 Chromium 完成 Task 卡打开、Agent 阶段展开、高级诊断展开、桌面与 390px 移动视口检查。可访问性快照确认 Task 卡是 Button、七阶段与高级诊断可键盘展开、Restate 链接包含精确过滤参数：

- [桌面中文任务旅程](./evidence/coding-task-journey-desktop.png)
- [移动端中文任务旅程](./evidence/coding-task-journey-mobile.png)

## 当前边界

- Demo 默认使用确定性 Fake Agent，不代表真实模型质量；真实 Codex 仍通过独立 Fixture Smoke 验证；
- Restate UI 未被修改或汉化，它仍是高级运行时排障工具；Moye Board 才聚合业务任务与 Agent 流转；
- 页面只读，不在本 Task 中增加重试、Repair 或人工恢复命令；
- Daemon 集群、多 Agent 调度、远程 Git/PR 和生产 Observability 仍属于后续 Backlog。
