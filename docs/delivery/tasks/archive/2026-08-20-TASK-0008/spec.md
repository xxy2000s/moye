# TASK-0008 Spec：可理解的 Coding Demo 与中文 Agent 流转看板

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0009

## 目标

让第一次运行 Moye 的用户无需理解 Restate 的 Service、Handler 和 Invocation，就能从一个真实 Fake Coding Demo 看懂“一个任务如何创建工作区、派发 Agent、验证、合并并归档”，同时仍能按 `task_id` 下钻到底层运行时和技术证据。

## Requirements

### REQ-0008-01：完整 Coding Demo

- `npm run demo` 必须在 `.moye-runtime/demo` 下创建隔离 Git Fixture，并提交 keyed `CodingTaskWorkflow/<task_id>`；
- Demo 使用确定性 Fake Agent，产生 Session、Branch、Result/Merge Commit、Verification 与 Archive Evidence；
- Demo 不修改 Moye 仓库，不默认调用真实 Codex；完成后清理 Worktree 缓存并保留可审计 Fixture/Artifact。

### REQ-0008-02：中文任务旅程

- Coding Task 详情默认展示 `需求与上下文 → 隔离工作区 → Agent 编码 → 自动验证 → 合入分支 → 文档检查 → 归档`；
- 每一阶段显示中文状态、当前焦点、Attempt、耗时或关键结果，不能只显示内部枚举；
- 成功、失败、执行中和未开始同时使用文字、形状和颜色表达。

### REQ-0008-03：稳定关联与下钻

- 页面清楚说明 `task_id → CodingTaskWorkflow → Step/Attempt → Agent Session → Git/Verification` 的关联；
- 默认视图只展示业务结论，Agent/Git/验证作为阶段详情，Artifact 和 Restate Journal 放入高级排障区；
- Restate 链接带对应 `CodingTaskWorkflow` 与 Task key 的过滤条件，不再只打开 Admin 首页。

### REQ-0008-04：可用性、响应式与失败恢复

- 任务卡片、阶段详情和折叠区支持键盘操作与可见焦点；交互目标不小于 44px；
- 窄屏无横向溢出，不复制两套移动/桌面内容；
- Trace/Runtime 读取失败时在问题附近显示原因、任务状态不变的说明和明确下一步。

### REQ-0008-05：验证与中文文档

- 单元测试覆盖阶段映射、Restate 深链和 Demo 输入边界；
- 真实 Restate E2E 证明 Demo 产生完整 Coding Trace 和唯一 Merge；
- 使用真实 Chromium 检查中文内容、键盘语义、桌面与移动布局；
- README、Architecture、CodeMap 和 Runbook 与实际入口同步。

## 非目标

- 不修改或汉化 Restate 自带前端；
- 不把 Restate Journal 复制成第二份业务状态；
- 不在 Demo 中调用真实 Codex、远程 Git Provider 或多 Agent；
- 不实现 Repair/Replan、生产 Telemetry、鉴权或多租户。

## 完成定义

一键 Demo 产生一个可点击的 Coding Task；用户在 Moye 页面能理解完整任务与 Agent 流转，并可从高级排障精确定位 Restate；全量单测、真实 E2E、文档门禁和浏览器验收通过，随后通过正常 Runtime Closure 与 Archive。
