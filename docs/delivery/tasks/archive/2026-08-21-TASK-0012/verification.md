# TASK-0012 Verification

> 状态：Accepted
> 验证日期：2026-08-21  
> Spec Revision：1

## 验收结论

TASK-0012 满足 Spec Revision 1：Agent Events Viewer 已从 Task Detail 正文移出，由独立顶层原生 Dialog 承载；事件数据与任务详情保持关联，但拥有独立滚动、轮询和关闭生命周期。

## 自动化证据

- `npm run check`：通过；TypeScript、17 个单元测试文件共 96 项及文档图校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项通过；
- Demo E2E 断言 `task-detail` 与 `agent-events-dialog` 是两个同级 Dialog，Viewer 不再由 Task Detail HTML 动态内联；
- `node --check public/app.js` 与 `git diff --check` 通过。

## 真实浏览器证据

在 `http://127.0.0.1:53930` 对真实 Codex Task `TASK-DEMO-MT2XZ0EC` 验证：

1. Task Detail 打开后正文只有 Agent Events 入口；
2. 点击入口出现第二个独立 Dialog，并显示 `已加载 17 / 17 条 · 已完成`；
3. 分类为对话 3、工具调用 5、工具结果 5、系统 3、错误 1；工具调用筛选后列表精确保留 5 条；
4. 390 × 844 viewport 下 header、下载、横向筛选、事件列表与 footer 均可访问，事件主体独立滚动；
5. 关闭按钮与第一次 Escape 只关闭 Event Dialog，Task Detail 保持打开；焦点返回“查看 Agent Events”；第二次 Escape 关闭 Task Detail；
6. 浏览器控制台 0 error、0 warning。

## 边界

- 本次只改变 Viewer 宿主、弹窗栈与前端轮询生命周期；
- Agent JSONL、cursor API、Artifact、Trace、Task Workflow 与状态所有权没有变化。
