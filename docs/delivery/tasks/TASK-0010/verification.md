# TASK-0010 Verification

> 状态：Accepted
> 验证日期：2026-08-21
> Spec Revision：1

## 验收结论

TASK-0010 满足 Spec Revision 1：`查看 Agent Events` 不再打开 NDJSON 响应并触发浏览器下载，而是在当前 Task 详情中加载并展示 Agent 事件；原始文件保留为明确标注的 `下载原始 JSONL` 次级入口。

## 自动化证据

- `npm run check`：通过；TypeScript 类型检查通过，17 个单元测试文件共 94 项通过，文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 10 项通过；
- `tests/e2e/demo.test.ts`：确认受控 Agent Events API 仍返回 Task 对应事件，并确认前端包含内联 Viewer、原始下载标签且不再包含旧的 `查看 Agent Events ↗` 下载入口；
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0010/docs-impact.yaml`：通过；最终输出在 Result Commit 前再次执行。

## 真实浏览器验收

使用 Playwright CLI 打开当前运行中的 `http://127.0.0.1:53930`，对 `TASK-DEMO-MT2W1U9L` 执行：

1. 打开 Task 详情，确认诊断入口是原生按钮 `查看 Agent Events`；
2. 点击后保持在当前页面，成功显示 4 条事件及中文摘要；
3. 展开第一条 `thread.started`，确认格式化原始 JSON 可读；
4. 确认页面提供独立的 `下载原始 JSONL` 链接；
5. 将 viewport 调整为 `390 × 844`，事件标题、状态、下载入口与列表保持可访问；
6. 浏览器控制台为 0 error、0 warning。

浏览器验收结束后已关闭 Playwright 会话并清理临时快照；现有 Moye Demo 与 Phoenix 服务保持运行，供用户直接查看。

## 安全与边界

- 内联查看继续请求 Trace API 返回的 allowlisted Artifact URL，不接受任意本地路径；
- 每个字段及原始 JSON 都通过 HTML 转义后渲染；异常 JSON 行只按文本展示；
- 最多渲染前 200 条事件，超出部分明确提示下载原始文件；
- Projection、Domain Event、Restate Journal 和 Artifact 的权威边界未改变。

## Runtime Closure 重试记录

首次关闭调用 `inv_12JvUT9LtpIv1KybDkGiKh52OyTHR5LOGN` 被 Bootstrap Gate 以 `BOOTSTRAP_IMPACT_INCOMPLETE` 拒绝：Docs Impact 使用了 `docs/delivery/tasks/TASK-0010` 目录缩写，而关闭器要求逐项覆盖 Task Package 的六个实际文件。拒绝发生在关闭材料持久化和 Archive 之前，Runtime Projection 保持在 `EXECUTING / implementation / NOT_READY`。

处置方式是补齐六个精确路径并生成新 Result Commit，然后仅 purge 上述已完成且失败的 invocation，再用同一 `TASK-0010`、同一 Spec Revision 和同一 Workflow key 重新附着。没有直接编辑 Runtime 状态，也不会创建第二个业务 Task。
