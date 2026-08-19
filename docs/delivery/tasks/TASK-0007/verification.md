# TASK-0007 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）

## 验收映射

| Requirement | 证据 | 结果 |
|---|---|---|
| REQ-0007-01 | `TaskAuthority.get` 解析唯一 owner；`/api/tasks/<id>/trace` 从 Coding Projection 返回 Step、Attempt、Session、Branch、Commit 与 Verification | 通过 |
| REQ-0007-02 | API/UI 明确分区 Business Facts、Durable Runtime、Technical Evidence；技术 Artifact 没有状态写入口 | 通过 |
| REQ-0007-03 | 纯函数派生 `NONE / WAIT_OR_RECONCILE / FAILED_TERMINAL / ARCHIVE_RETRY`，页面只展示建议 | 通过 |
| REQ-0007-04 | 真实 Restate E2E 覆盖 Agent 异常、Service 重启、Git 完成后退出、重复命令和验证失败 | 通过 |
| REQ-0007-05 | README、Architecture、CodeMap、Runbook 已同步；浏览器视觉验收完成 | 通过 |

## 自动化证据

- `npm run check`：TypeScript、82/82 单元测试、文档图全部通过；
- `npm run test:e2e`：3 个测试文件、9/9 真实 Restate E2E 通过；
- Coding E2E 证明同一 Workflow 重复命令由 Restate 409 拒绝，Merge Effect marker 仍唯一；
- Agent exit 19 形成 `IMPLEMENT/FAILED` 与 `FAILED_TERMINAL`，目标 master 保持 Base；
- Verification 失败不 Merge；Verification Activity 中断重启后命令计数仍为 1，并安全停止为 `RESULT_UNKNOWN`；
- Git `update-ref` 成功后 Worker 立即 exit 76，新 Worker 对账为 `ALREADY_APPLIED` 并完成唯一归档；
- Merge 丢失 Git ref 更新回执后通过 marker、双亲和 ancestry 对账，不产生第二个 Merge。
- Workspace、Agent、Verification、Merge 的 `UNKNOWN_SIDE_EFFECT` 均保存结构化 `errorCode/errorCategory` 并派生“先对账”，不会建议盲目新建 Task；
- Board 静态服务使用 lexical + realpath containment，符号链接根外读取测试返回 404；Malformed Task ID 返回受控 400；
- Git 强杀/丢回执注入仅在显式 test-only 环境门禁下启用，正常输入无法终止 Service。

## 浏览器证据

使用真实 Chromium 打开本地 Board、点击 Coding Task 并检查可访问性快照。页面展示 6 个 Step/Attempt、业务事件、Restate Workflow Ref、Agent Session、Git Commit 链、Verification 与 Artifact 引用；截图见 [`evidence/trace-detail.png`](./evidence/trace-detail.png)。临时预览服务和 Playwright 会话已清理。

## 独立复审

首轮只读复审发现 UNKNOWN 恢复分类不完整、静态符号链接逃逸和故障注入边界过宽三项 Major；全部修复并增加聚焦测试。第二轮复审结论为 `RELEASE READY`，无 blocker / major，确认 Trace 仍为只读纯派生、四类 UNKNOWN 均先对账、静态 realpath containment 和 test-only fault 门禁有效。

## 当前边界

- 恢复视图只读，不实现 BL-0003 的 Repair/Replan 或 BudgetLedger；
- Restate Admin 只提供入口，不复制 Journal 内容；生产级 OTel、指标和告警仍属于 BL-0006；
- 本地 Git 闭环不包含远程 Provider、PR 或 Merge Queue。
- Test-only fault 目前由进程环境门禁控制；未来可改成测试专用 Service/依赖注入，消除 durable replay 期间的环境漂移可能。
- 静态目录按本地受信只读部署建模；若未来允许不受信本地写者，需要再用 fd/no-follow 防御 `realpath` 到 `open` 之间的符号链接竞态。
