# TASK-0026 Verification

> 状态：Accepted
> 验证日期：2026-08-22

## 自动化

- `node --check public/app.js`：通过；
- `npm run check`：通过，28 个测试文件、155 个测试全部通过；
- `npm run test:e2e`：通过，5 个 E2E 文件、14 个测试全部通过；
- `git diff --check`：通过；
- 浏览器 Console：0 Error、0 Warning。

## 真实浏览器验收

验收对象为本任务 Worktree 启动的真实 Board `http://127.0.0.1:3020`，读取持久 Restate Projection 与真实 Codex Session Artifact：

1. `IMPLEMENT` 节点首屏显示真实 Agent Activity、Session、耗时、完整 Events 主入口，以及 21 条真实 Event 的分类计数和最后三条活动；
2. Chatbot Dialog 完整加载 21 条 JSONL Event：5 条对话、6 次工具调用、6 次工具结果、3 条系统和 1 条错误，分类筛选有效；
3. 关闭 Chatbot Dialog 后焦点准确回到节点内的“查看全部 Agent Events”；
4. `VERIFY` 显示 `0 Agent`，只呈现 Domain Event、Verification 命令和系统结果，没有伪造 Session；
5. Domain Event 在界面解释为 Workflow 写入的状态流转业务事实，并与 Agent 对话/工具日志明确分区；
6. `390 × 844` 竖屏 Bottom Sheet 和 `844 × 390` 横屏均可读、可滚动且无横向溢出；桌面 Inspector 与画布同时保持可用。

## 结果

验收标准全部满足。实现只读取既有 Trace 与受控 Session Events API，不修改 Workflow/Projection，不创建 Mock/Fake Event，也不引入第二套状态机。
