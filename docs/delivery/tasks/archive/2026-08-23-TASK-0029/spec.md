# TASK-0029 Spec：Bootstrap 预检、失败收敛与历史任务恢复

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0031](../../../backlog/BL-0031.yaml)
> Incident：[2026-08-22 Bootstrap 基线门禁导致 Projection 停留 EXECUTING](../../../../sources/incidents/2026-08-22-bootstrap-base-commit-gate-left-projection-executing.md)

## 目标

修复 Bootstrap Closure 只有证据完整性保护、没有业务失败收敛的问题。新的无效请求必须在 Runtime 写入前被拒绝；已经进入 Workflow 的确定性失败必须形成唯一业务终态并归档；历史 `TASK-0028` 必须通过显式、可审计的 successor recovery Workflow 合法收敛，不能改写原 Projection、删除 Invocation 或重写 Git 历史。

## 需求

### REQ-0029-01：派发前冻结基线预检

- 抽取独立 Bootstrap Preflight，验证 Task Manifest 已提交、声明 `goal-bootstrap`、`base_commit` 存在，并等于 Manifest 引入提交的父提交；
- CLI `validate/create/close` 在 send/invoke 前执行相同预检；
- `TaskWorkflow` 在 `TaskAuthority.claim` 和首次 Projection/Event 写入前再次执行，保证绕过 CLI 的请求也不能污染 Runtime；
- Preflight 失败不得创建 Task Authority、Projection 或 Board 记录。

### REQ-0029-02：派发后确定性失败唯一收敛

- Bootstrap Evidence 的 Validation/Conflict 或持久化失败不能以未捕获 TerminalError 留下 `EXECUTING`；
- Workflow 捕获非 Restate 控制错误，使用现有 Task reducer 形成 `FAILED_TERMINAL`、唯一 `TaskClosed` Event 和 Failure Artifact；
- 失败 Task 进入同一 `ArchiveWorkflow`，Archive 失败与业务 Outcome 正交；
- 重放或重复 attach 不产生第二个终态或第二次 Archive。

### REQ-0029-03：TASK-0028 合法恢复

- Restate 1.7.4 已终止失败的 keyed Workflow 不支持 restart-as-new；不得 purge/reinvoke、patch state、直接 upsert Board 或伪造 CLOSED Projection；
- 实现窄化的 `BootstrapFailureRecoveryWorkflow/<task_id>` 作为显式 successor：读取原 `TaskWorkflow` shared Projection，核对已知 Bootstrap 冻结失败与恢复前置条件，再追加 Recovery 与 `FAILED_TERMINAL` 事实并调用同一 Archive；
- `TaskAuthority` 保存 append-only recovery handoff 引用；CLI 和 Board 根据权威路由读取 successor Projection，同时保留原 Workflow/Invocation 引用；
- recovery 重复执行返回相同 Projection，不能恢复成功任务、非 Bootstrap 任务或不匹配的失败。

### REQ-0029-04：真实证据

- 单元测试覆盖有效/无效 preflight、无 Runtime 写入、失败 Artifact 幂等和 recovery 前置条件；
- 真实 Restate E2E 覆盖错误基线的 Invocation failure、派发后确定性失败、重复 attach、Board/Event/Archive 一致性和 recovery handoff；
- 最终实际收敛 `TASK-0028`，保留原失败历史并在 CLI、Board 与 Archive 中得到一致终态。

## 非目标

- 放宽或删除 `base_commit` 冻结门禁；
- 通过扫描 Git 历史伪造 Runtime 任务状态；
- 重写 TASK-0028 原始事件或 Git 历史；
- 顺带重构 Core v2 Agent 角色、Board 画布或归档提交协议。
