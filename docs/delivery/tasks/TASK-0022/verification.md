# TASK-0022 Verification

> 状态：Accepted  
> 验证日期：2026-08-22

## 实现证据

- `public/app.js` 不再为 Role、Implementation 或 Review Session 渲染 `eventsUrl + target="_blank"`；所有入口都是带 `aria-haspopup="dialog"` 的按钮；
- Dialog Controller 从按钮读取 Trace 已提供的受控 URL、Role、Revision/Attempt、Session 和 Runner，关闭旧 Session 时终止 poll timer；
- Event Transcript 以 User/Agent 对话气泡、工具调用、工具结果、系统和错误卡片呈现；每条保留 sequence/type 与可折叠原始 JSON；
- 顶部六类 Filter 保留服务端 category 和实时数量；运行中 cursor 跟随、完成后分页/导出行为不变；
- 控件最小高度 44px、Filter 使用 `aria-pressed`、关闭后恢复触发按钮焦点。

## 自动化证据

```text
node --check public/app.js                     passed
npm run check                                 passed
  typecheck                                   passed
  28 unit/integration files / 155 tests       passed
  docs graph 199 documents / 325 relations    passed
npm run test:e2e                              passed
  5 Playwright files / 14 tests               passed
git diff --check                              passed
```

Demo E2E 增加静态契约：Session Events 必须使用 `sessionEventsButton`，包含 Chat Transcript 语义，且代码中不得重新出现“查看原始 Events ↗”或 `eventsUrl + target="_blank"`。

## 真实浏览器证据

在持久化 Restate Project `moye` 和临时验收 Board `http://127.0.0.1:3020` 打开真实任务 `TASK-LIVE-ROLE-STREAM-2-20260822`：

1. Task Detail 显示 5 个真实执行会话，每个都有“在弹窗查看对话”按钮；
2. 点击 Context 后页面 URL 保持 `/`、浏览器仍只有一个 Tab，Dialog 标题为 `Context · 交互记录`；
3. Context Session `01a0280d-169f-7ac0-89da-d7ccec064de3` 加载 12/12 条真实 Codex 事件：对话 2、工具调用 3、工具结果 3、系统 3、错误 1；
4. 点击“工具结果 3”后 Transcript 精确只显示 sequence 06/08/10 三条工具输出；
5. 关闭 Dialog 后焦点返回原 Context 按钮；再次点击 Self Review，标题与 Session 切换为 `Self Review · 交互记录 / 01a0280e-e3e8-7ad1-8e13-5fd6f53907e7`，加载 9/9 条；
6. 390×844 viewport 下 Header、横向 Filter、消息流、Footer 独立可达，无页面跳转。

## 验收结论

实现、自动化测试和真实浏览器门禁已通过。Result Commit、Runtime Closure 与 Archive 回执由任务关闭流程在本报告之后登记，不影响本次行为验收结论。
