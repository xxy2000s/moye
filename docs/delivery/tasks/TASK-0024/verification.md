# TASK-0024 Verification

> 状态：Passed  
> 验证日期：2026-08-22

## 自动化

- `node --check public/app.js`：通过；
- `npm run check`：通过，28 个测试文件、155 个测试全部通过；
- `npm run test:e2e`：通过，5 个 E2E 文件、14 个测试全部通过；
- `ruby scripts/docs_graph.rb validate`：通过，213 个文档、343 条关系、140 个 Markdown；
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0024/docs-impact.yaml`：通过，27 个 required read 与 27 个 reviewed impact 完整处置；
- `git diff --check`：通过。

## 真实浏览器验收

验收对象为本任务 Worktree 启动的真实 Board `http://127.0.0.1:3020`，数据来自持久 Restate Projection 和真实 Codex Session Artifact：

1. 桌面 `1440 × 900`：Task Audit Workspace 居中；默认只有摘要与完整 Graph，Inspector 未打开；
2. 点击 `ARCHIVED` 节点：画布右侧出现 Inspector，展示入边、出边、Event 和 Execution；关闭后画布状态保留；
3. 按 `Esc`：先关闭 Inspector，Task Dialog 保持打开，焦点返回来源节点；
4. 展开“实际路径”：显示 11 条由 Event sequence/type/time 证明的转换；
5. 打开“查看完整对话”：独立 Chatbot Dialog 加载 21 条真实 JSONL Event；“工具结果”筛选只显示 6 条对应消息；
6. 手机 `375 × 812`：Task Dialog 精确占满视口，根页面横向溢出为 0；节点详情以底部 Bottom Sheet 展示；
7. 横屏 `844 × 390`：Dialog 保持在视口内，根页面横向溢出为 0；
8. `prefers-reduced-motion: reduce`：Graph 与 SVG transition 均为 `0s`，卡片动画为 `none`；
9. 浏览器 Console：0 Error、0 Warning。

## 结果

验收标准全部满足。Graph 仍只消费 Runtime Definition、Event History 和 Execution Evidence；新增 Inspector、Bottom Sheet、筛选、缩放、滚动和折叠状态均为浏览器内只读状态，没有增加第二套 Runtime 状态机。
