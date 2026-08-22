# TASK-0021 Design

## 产品主线

现有真实 `CodingTaskWorkflow` 已拥有 Worktree、Agent、Verification、Review、Merge 和 Archive，现有 Core Domain 已拥有 Role/Decision/Finding/Repair/Replan/Budget/Closure 协议。本任务不创建第三套主状态机，而是把 Core 控制事实接入真实 Coding 产品主线，并让同一 Projection 成为 Board 的唯一业务事实。

```text
CLI/API
  → TaskAuthority claim
  → Context / Docs Role
  → Implementation Role
  → Self Review
  → Verification
  → Independent Review
       ├─ ACCEPT → Merge → Docs Gate → Closure → Archive
       ├─ REPAIR → new Implementation Generation
       └─ REPLAN → Spec Revision N+1 → Docs Role
```

## 状态与执行事实

- Workflow 在调用任何模型或副作用前先发布 Step/Attempt/Run Intent；
- 每个 Role Run 都有独立 Session 和内容寻址 Artifact；
- Self Review 是独立事实，不替代 independent Review；
- Replan 生成新的冻结 Envelope，旧 Revision 的 Verification/Review 不能满足新 Gate；
- Coding 成功、失败和未知均由同一 Event reducer 派生 Board/Trace；Board 没有写入口。

## 入口与恢复

CLI 的产品命令调用 Board Product API，避免复制 Live Task 输入验证；`status/wait` 通过公共 Task API/TaskAuthority 解析 owner。Reconcile 命令必须带 Expected state/digest 和 Evidence；Workflow 只消费匹配当前未知操作的命令。失败 Archive 与成功 Archive 使用相同幂等 Adapter。

Board 每五秒同时刷新 lane projection 和当前打开 Task 的 Trace。详情只在 Trace 事实签名变化时重绘，保留滚动位置；打开原始 Agent Events 跟随器时暂停详情重绘，避免丢失事件游标。这样用户可以保持同一个详情弹窗从 `RECEIVED` 观察到 `ARCHIVED`，不会出现看板已归档而详情仍停在旧 Attempt 的双重事实。

Implementation、Context、Self Review、Replan、Review 与 Docs Gate 都在执行前发布稳定 Run Locator，并将 stdout JSONL 增量写入受管 Artifact；结束后再发布独立 Session、Manifest、完整摘要与内容摘要校验。Request canonicalization 对已准备的 Request 幂等，防止 Projection locator 与实际 Artifact 目录发生二次摘要漂移。页面不根据模型输出直接推进状态，所有显示仍由 Workflow Projection 和 Domain Event 派生。

## 兼容性

确定性 `CoreClosureWorkflow` 六场景保留为控制协议和恢复回归，但不出现在真实产品能力声明。现有 `TaskWorkflow` 继续用于通用/Bootstrap Task；真实研发任务统一走产品 Coding/Core 主线。
