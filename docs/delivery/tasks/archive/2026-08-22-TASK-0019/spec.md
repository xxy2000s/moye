# TASK-0019 Spec：接入真实 Agent 的页面可用编码闭环

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0020

## 目标

把真实本地编码执行接到 Moye 页面。用户提交一个仓库任务后，系统必须真实启动 Codex 或 Claude、在隔离 Worktree 修改代码、进行独立只读 Review、按 Finding Repair、运行验证、形成 Git 结果并完成文档处置、关闭与归档。

## Requirements

### REQ-0019-01：真实产品入口

- 页面可填写任务目标、仓库、目标分支、Agent runner 和验证命令；
- 产品 API 只允许 `CODEX_EXEC | CLAUDE_PRINT`，显式拒绝 `FAKE` 或缺失的真实 runner；
- 提交返回稳定 `task_id`，Board 从 Runtime Projection 展示执行进展，不以静态 Demo 数据冒充。

### REQ-0019-02：真实 Implementation、Review 与 Repair

- Implementation 与 Review 都启动真实 Agent 进程，并记录 Attempt、Runner、退出状态、摘要和原始事件 Artifact；
- Review 使用与 Implementation 不同的 CLI Session 和只读权限，Implementation/Repair 才能修改 Worktree；
- Blocking Finding 触发一次新的真实 Implementation Repair Attempt、重新验证与重新 Review，不以固定 Scenario 代替模型输出；
- Agent 非零退出、超时、不可解析输出和未知副作用都有显式失败或对账语义。

### REQ-0019-03：Git、验证与文档闭环

- 执行发生在隔离 Worktree；候选改动通过用户声明的验证命令；
- 成功形成唯一 Result Commit 并安全合入目标分支；旧 Attempt 不能覆盖新结果；
- 用户必须声明 Docs disposition；Moye 自身变更仍遵守仓库 Router/Graph/Impact Gate；
- Coding Task 的业务关闭与外层 Archive 分开记录，Archive 失败不改写业务结果。

### REQ-0019-04：页面观察

- Board 展示当前阶段、Attempt、Runner、验证结果、Review/Finding、Result Commit、Closure 和 Archive；
- Agent Events 指向真实 CLI 事件，不展示伪造角色事件；
- 失败时展示可操作原因，而不是静默回落 Fake。

### REQ-0019-05：真实验收

- 在临时 Git 仓库从页面/API 提交至少一个真实 `CODEX_EXEC` 任务；
- 证明确实启动 Codex、修改文件、运行验证、提交、合入、关闭并归档；
- 自动化 Fake/Mock 测试只验证确定性边界，不能作为本 Requirement 的通过证据；
- `npm run check`、相关真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 本 Slice 不实现远程 Git Provider/PR、多 Daemon Lease 或云端生产部署；
- 不把通用 `CoreClosureWorkflow` 的 Fake Role Runner 替换成真实 Adapter，也不实现独立 Docs Role 或 Spec Replan；这些不是页面真实 Coding Task 成功的隐藏前提；
- 不承诺模型对任意模糊需求一次成功，但失败必须真实、可观察、可恢复；
- 不移除已有 Fake 测试夹具，只禁止产品入口和产品验收使用它。

## 完成定义

一个用户可从 Moye 页面提交、由真实 Codex/Claude 执行并可在页面观察直至 Git/Docs disposition/Coding Closure/Archive 终态的本地编码任务；至少一个真实 Codex E2E 可重复通过。
