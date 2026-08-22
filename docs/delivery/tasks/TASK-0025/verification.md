# TASK-0025 Verification

> 状态：Accepted
> 验证日期：2026-08-22

## 自动化

- `node --check public/app.js`：通过；
- `npm run check`：通过，28 个测试文件、155 个测试全部通过；
- `npm run test:e2e`：通过，5 个 E2E 文件、14 个测试全部通过；
- `ruby scripts/docs_graph.rb validate`：通过，221 个文档、354 条关系、145 个 Markdown；
- `git diff --check`：通过。

## 真实浏览器验收

验收对象为本任务 Worktree 启动的真实 Board `http://127.0.0.1:3020`，读取持久 Restate Projection 与真实 Codex Session Artifact：

1. `IMPLEMENT` 节点显示实际 Event、Step Attempt、Agent Run、Generation、执行 ID、Session、耗时、R/G Evidence Binding、Result Commit、Result Tree 与进程结果；
2. 从节点内打开 Chatbot Dialog，成功加载 21 条真实 JSONL Event，并显示 5 条对话、6 条工具调用、6 条工具结果、3 条系统事件和 1 条错误事件；
3. `SELF_REVIEW` 与 `REVIEW` 显示独立 Role/Review Run、Verdict、真实摘要、Finding 数量和 Session Events 入口；
4. `VERIFY` 显示 Step Attempt、Verification、`CMD-ROLE-STREAM-2`、exit 0、1 ms 以及 stdout/stderr digest；
5. `DOCS` 同时显示 Step Attempt 与 `DOCS_GATE` Role Run；
6. 未经过的 `REPLAN` 显示 0 Event、0 执行实例，并明确不虚构 Attempt、Session 或 Evidence；
7. 真实失败任务的 `FAILED` 节点显示 `CONTEXT → FAILED`、完整错误、恢复分类、恢复判断、Outcome 与人工后续动作；
8. `390 × 844` 竖屏使用可滚动 Bottom Sheet，`844 × 390` 横屏保持可读；`Esc` 先关闭节点详情并将焦点返回来源节点；
9. 浏览器 Console：0 Error、0 Warning。

## 结果

验收标准全部满足。实现只聚合既有 Trace API 事实，没有修改 Workflow/Projection，也没有引入第二套状态机或 Fake 记录。
