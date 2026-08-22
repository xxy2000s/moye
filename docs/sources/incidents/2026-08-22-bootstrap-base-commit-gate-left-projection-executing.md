# Incident：Bootstrap 基线门禁失败后 Projection 停留在 EXECUTING

> 状态：Resolved
> 日期：2026-08-22
> 严重级别：Development task closure blocked
> 负责人：Moye
> 来源或关联 Task：TASK-0028

## Summary

TASK-0028 首次登记时把父提交 `ed2b9211...` 误写为不存在的 `ed2b9214...`。实现完成后虽修正当前 Manifest，Bootstrap Closure 仍正确拒绝关闭，因为 `base_commit` 必须在 Manifest 首次引入时冻结，不能事后改写。

Restate 的 `TaskWorkflow/TASK-0028/run` Invocation 以 `BOOTSTRAP_BASE_COMMIT_NOT_FROZEN` 完成失败，但此前已经持久化的 Task Projection 仍停在 `EXECUTING`。TASK-0029 增加派发前预检、派发后失败收敛和 append-only successor recovery；2026-08-23 已在保留原 Projection/Invocation 的前提下把 TASK-0028 收敛为 `FAILED_TERMINAL + ARCHIVED`。

## Impact

- TASK-0028 无法关闭或归档；
- Board 真实显示该 Task 停留在 `EXECUTING`，而 Restate Invocation 已是 completed/failure；
- 防篡改门禁本身按设计工作，没有放宽或绕过；
- 已合入的全屏路由、Domain Event 时间线和持久化入口不受影响。

## Timeline

| 时间 | 事件 |
|---|---|
| 16:14 | TASK-0028 实现、文档和验证提交到 `c5fc46d` |
| 16:15 | `close` 返回 `BOOTSTRAP_BASE_COMMIT_NOT_FROZEN` |
| 16:16 | `status TASK-0028` 确认 Projection 为 `EXECUTING`，事件停在 `TaskExecuting` |
| 16:17 | Introspection SQL 确认 owning run Invocation 为 `completed/failure` |
| 16:18 | 新 UI 已部署到主 Board；未修改 Runtime 主状态或伪造归档 |
| 2026-08-23 01:25 | 新部署按原 Invocation ID attach 失败，重放同一 Git 基线错误并创建唯一 Recovery successor |
| 2026-08-23 01:25 | successor 追加 `TaskRecoveryStarted → TaskClosed`，ArchiveWorkflow 完成唯一归档 |

## Detection

由真实 Bootstrap Closure Gate 在关闭时检测。Task 创建阶段只校验了 Manifest 结构，没有在提交后、派发前验证 `base_commit == introduction parent`，因此错误直到关闭才暴露。

## Root Cause

登记 Task 时人工复制了错误的完整 SHA；后续检查只确认该字段格式合法，没有确认对象存在及等于 Task 引入提交的父提交。TaskWorkflow 对 Bootstrap Evidence 校验失败直接返回 Invocation Failure，没有把这个确定性失败转换为业务失败终态。

## Contributing Factors

- Bootstrap 的强校验只在关闭路径执行，缺少创建/派发前的同规则预检；
- TaskWorkflow 在写入 `EXECUTING` 后没有捕获 Bootstrap Closure 的确定性 Validation/Conflict；
- 当前通用 Task 状态机没有对这类自举材料失败提供合法的失败归档路径。

## Resolution

TASK-0029 实现三层同源预检：CLI 派发前、TaskWorkflow 首次状态写入前、最终 Closure Gate。进入 Projection 后的确定性 Bootstrap 失败由原 Workflow terminalize 并归档。

对已经完成失败的 TASK-0028，`BootstrapFailureRecoveryWorkflow/TASK-0028` 按原 Invocation ID attach 并确认相同 `BOOTSTRAP_BASE_COMMIT_NOT_FROZEN`，再次只读核验 Git 基线后，由 TaskAuthority 追加一次 recovery ref。successor 从原事件序列继续追加 Recovery/TaskClosed，并调用既有 ArchiveWorkflow。原 TaskWorkflow Projection 与失败 Invocation 保持未修改。

## Evidence

- Close 响应：HTTP 409，`BOOTSTRAP_BASE_COMMIT_NOT_FROZEN`；
- `TaskWorkflow/TASK-0028/status`：`state=EXECUTING`，最后事件为 `TaskExecuting`；
- `sys_invocation`：`TaskWorkflow/TASK-0028/run` 为 `completed/failure`；
- Git：Manifest 引入提交为 `6da186f`，其父提交为 `ed2b9211d44bc024fbf1b3aecd82533ccbfa00a1`。
- 原失败 Invocation：`inv_11E8Qgaf5P8C7sJatlpDb7inf2nwlhoknv`，仍为失败历史来源；
- Recovery Projection：Event sequence 3～6 为 `TaskRecoveryStarted`、`TaskClosed`、`ArchivePending`、`ArchiveArchived`；
- 最终结果：`state=CLOSED`、`outcome=FAILED_TERMINAL`、`archiveStatus=ARCHIVED`；
- Archive Artifact：`docs/delivery/tasks/archive/2026-08-23-TASK-0028/bootstrap-runtime-failure.json`。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0031 | Prevent / Recover | 提前校验 Bootstrap 基线，并让确定性关闭材料失败收敛为可审计终态 | Converted to TASK-0029 |

## Immediate Action Items

| 行动 | 类型 | 负责人 | 截止时间 | 状态 |
|---|---|---|---|---|
| 保留 Projection、Invocation 和 Task Artifact 原始失败证据 | Mitigate | Moye | 2026-08-22 | Done |
| 增加创建前基线预检与 Workflow 失败收敛路径 | Prevent | TASK-0029 | 2026-08-23 | Done |

## Knowledge Promotion

- 是否形成 Pitfall：已新增 Durable Runtime Pitfall #14，覆盖晚校验导致 Invocation 与业务状态分离；
- 是否需要 ADR：否，不改变防篡改原则；
- 是否更新 Architecture/Runbook：TASK-0029 已更新 Task Runtime、Restate PoC、CodeMap、Runbook 与 CLI 操作说明。
