# TASK-0023 Verification

> 状态：Accepted  
> 验证日期：2026-08-22

## 实现证据

- Graph 直接遍历 `machine.definition.nodes` 与 `machine.definition.edges`，没有维护第二份前端状态集合；
- `node.status`、`edge.traversed`、`machine.history` 和 `machine.executions` 分别驱动节点点亮、实际边、Event 序号与 Inspector Evidence；
- 默认“全部流程”保留全部合法边，顶部可切换本次点亮、主流程、恢复/回滚、异常/失败和归档；
- SVG 使用确定性三分区布局与曲线路由，原生按钮节点支持点击、键盘与可见焦点；
- 放大、缩小、适配不依赖拖拽，筛选和缩放不写 Runtime 状态；
- 文本 History、执行实例与完整合法边列表仍然存在。

## 自动化证据

```text
node --check public/app.js                     passed
npm run check                                 passed
  typecheck                                   passed
  28 unit/integration files / 155 tests       passed
  docs graph 206 documents / 334 relations    passed
npm run test:e2e                              passed
  5 E2E files / 14 tests                      passed
git diff --check                              passed
```

Demo E2E 固定 Graph Controller、筛选、实际点亮、Recovery/Reconcile 和 Inspector 静态契约；既有 `state-machine-trace` 单测继续证明只有连续 Runtime Event 才能把合法边标为 `traversed`。

## 真实浏览器证据

在持久化 Restate Project `moye` 和临时验收 Board `http://127.0.0.1:3020` 验证：

1. 成功任务 `TASK-LIVE-ROLE-STREAM-2-20260822` 展示 16 个节点、45 条合法边和 11 条实际点亮边；当前节点为 `ARCHIVED`；
2. “恢复 / 回滚 12”只显示 Repair/Replan/Reconcile 返回边；选择 `REPLAN` 节点后 Inspector 显示 `REVIEW → REPLAN` 和 `REPLAN → CONTEXT` 的合法语义，但明确标记本次未进入；
3. 真实失败任务 `TASK-LIVE-REAL-REPLAN-20260822` 只点亮 4 条 Event 实际证明的边：`START → CONTEXT → FAILED → ARCHIVING → ARCHIVED`；虽然 Spec Revision 为 R2，页面没有虚构未出现在 History 中的 Replan 转换；
4. “本次点亮”筛选后的无障碍树精确只保留上述 4 条图形边；文本 History 同样为 4 条；
5. 节点选择更新入边、出边、实际 Event 和执行实例；缩放按钮与 Filter 都是原生按钮并具有 `aria-pressed`/可见焦点；
6. 390×844 viewport 下 Filter 换行、Zoom 可达，画布在受控区域横向浏览，页面无横向溢出；浏览器 Console 为 0 Error / 0 Warning。

## 验收结论

实现、自动化和真实浏览器门禁已通过。Result Commit、Runtime Closure 与 Archive 回执在本报告之后由任务关闭流程登记。
