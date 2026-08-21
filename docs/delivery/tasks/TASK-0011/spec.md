# TASK-0011 Spec：接入真实 Agent 完整事件流与交互看板

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0012

## 目标

让 Moye 的 Coding Demo 真正运行 Codex 或 Claude CLI，并在任务详情中看到执行期间产生的完整原始 JSONL，包括对话、工具调用、工具结果、系统信息与错误。事件视图必须与 Task/Step/Attempt/Run 可追踪绑定，不成为第二套业务状态机。

## Requirements

### REQ-0011-01：真实 Runner 与可选择 Demo

- 保留 `npm run demo` 的确定性 Fake 模式，用于快速演示和自动化回归；
- 提供 `npm run demo:codex` 与 `npm run demo:claude`，并支持显式 Runner 配置；
- 看板明确标识 Fake、Codex Exec 或 Claude Print，不把 Fake 事件描述为真实模型交互；
- 真实 Demo 在隔离 Fixture Repository 中执行既定低风险编码任务，并沿用现有 Verification、Merge、Docs 与 Archive 闭环。

### REQ-0011-02：逐行保存原始 Agent 事件

- 子进程 stdout 按 JSONL 行边界增量处理，正确处理任意 chunk 切分和末尾残行；
- 完整原始行不经摘要化改写地保存；每个事件流由不可变元数据绑定 `task_id`、`step_id`、`attempt_id`、`run_id`、Runner 和 Spec Revision；
- 运行中使用受管临时事件流，完成后仍由现有 Artifact Bundle、文件大小与内容摘要形成不可变证据；
- Agent 事件只是诊断/交接证据；Task 主状态只由 Coding Workflow 推进。

### REQ-0011-03：安全的 cursor 查询 API

- 看板只根据 Task Projection 已登记的 Agent Run 定位事件，不能接受任意本地路径；
- API 使用稳定 cursor 与有界 page size 返回事件、下一游标、是否还有更多、运行是否完成和总量快照；
- 用户可以通过连续分页访问全部事件，不存在固定 200 条的永久截断；
- 活跃文件读取限制在请求开始时的文件大小快照，完成 Artifact 继续执行 realpath、文件类型、大小和摘要校验。

### REQ-0011-04：交互式事件查看器

- 打开事件查看器后立即加载首批事件，运行中自动刷新，完成后停止轮询；
- 支持全部、对话、工具调用、工具结果、系统与错误分类；分类仅影响当前显示，不丢失原始事件；
- 每条事件显示顺序号、类型、可读摘要，并能展开完整原始 JSON 或原始文本；
- 支持手动加载更多/持续追踪、清晰的空态与错误态，窄屏和键盘操作可用。

### REQ-0011-05：验收与兼容性

- 单元测试覆盖 chunk 行解码、增量写入、cursor 边界、分类和安全拒绝；
- 真实 Restate E2E 使用延迟输出 Runner 证明运行中可见、完成后可访问全部事件；
- 至少运行一次本机真实 Codex CLI 隔离 Fixture，证明不是 Fake 且产生多于 4 条原始事件和工具调用；
- 使用真实浏览器验证加载、自动刷新、筛选、展开、加载全部与移动端布局；
- `npm run check`、`npm run test:e2e` 和文档影响门禁通过。

## 非目标

- 不采集供应商服务端未由 CLI 暴露的隐藏模型请求、隐藏推理或密钥；
- 不把 Agent JSONL 复制进 Restate Journal，也不让 Phoenix 代替业务 Event/Artifact；
- 不实现跨 Task 全文检索、长期日志集群、生产级 RBAC 或多 Daemon 共享对象存储；
- 不在全局修改用户的 Claude Settings 或 Codex 配置。

## 完成定义

用户启动真实 Codex Demo 后，可以在 Moye 看板中看到与该 Task/Attempt/Run 绑定、执行中持续增长、完成后可完整翻阅的原始 CLI JSONL；页面明确区分 Runner，工具过程不再被 4 条 Fake 事件或 200 条前端上限遮蔽，并通过自动化、真实 CLI 和浏览器端到端验收。
