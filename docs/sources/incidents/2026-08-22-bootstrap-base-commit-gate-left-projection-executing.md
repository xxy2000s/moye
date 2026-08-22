# Incident：Bootstrap 基线门禁失败后 Projection 停留在 EXECUTING

> 状态：Open / Mitigated
> 日期：2026-08-22
> 严重级别：Development task closure blocked
> 负责人：Moye
> 来源或关联 Task：TASK-0028

## Summary

TASK-0028 首次登记时把父提交 `ed2b9211...` 误写为不存在的 `ed2b9214...`。实现完成后虽修正当前 Manifest，Bootstrap Closure 仍正确拒绝关闭，因为 `base_commit` 必须在 Manifest 首次引入时冻结，不能事后改写。

Restate 的 `TaskWorkflow/TASK-0028/run` Invocation 以 `BOOTSTRAP_BASE_COMMIT_NOT_FROZEN` 完成失败，但此前已经持久化的 Task Projection 仍停在 `EXECUTING`。功能实现与页面服务可用，TASK-0028 不能通过 Archive Gate，保持 Active。

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

## Detection

由真实 Bootstrap Closure Gate 在关闭时检测。Task 创建阶段只校验了 Manifest 结构，没有在提交后、派发前验证 `base_commit == introduction parent`，因此错误直到关闭才暴露。

## Root Cause

登记 Task 时人工复制了错误的完整 SHA；后续检查只确认该字段格式合法，没有确认对象存在及等于 Task 引入提交的父提交。TaskWorkflow 对 Bootstrap Evidence 校验失败直接返回 Invocation Failure，没有把这个确定性失败转换为业务失败终态。

## Contributing Factors

- Bootstrap 的强校验只在关闭路径执行，缺少创建/派发前的同规则预检；
- TaskWorkflow 在写入 `EXECUTING` 后没有捕获 Bootstrap Closure 的确定性 Validation/Conflict；
- 当前通用 Task 状态机没有对这类自举材料失败提供合法的失败归档路径。

## Resolution

已保持 TASK-0028 Active 并保留真实 Runtime Failure，没有编辑 Projection、删除 Invocation、重写 Git 历史或放宽 Closure Gate。主页面服务已部署实现结果。永久修复进入 BL-0031。

## Evidence

- Close 响应：HTTP 409，`BOOTSTRAP_BASE_COMMIT_NOT_FROZEN`；
- `TaskWorkflow/TASK-0028/status`：`state=EXECUTING`，最后事件为 `TaskExecuting`；
- `sys_invocation`：`TaskWorkflow/TASK-0028/run` 为 `completed/failure`；
- Git：Manifest 引入提交为 `6da186f`，其父提交为 `ed2b9211d44bc024fbf1b3aecd82533ccbfa00a1`。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0031 | Prevent / Recover | 提前校验 Bootstrap 基线，并让确定性关闭材料失败收敛为可审计终态 | Captured |

## Immediate Action Items

| 行动 | 类型 | 负责人 | 截止时间 | 状态 |
|---|---|---|---|---|
| 保留 Projection、Invocation 和 Task Artifact 原始失败证据 | Mitigate | Moye | 2026-08-22 | Done |
| 增加创建前基线预检与 Workflow 失败收敛路径 | Prevent | BL-0031 | 待调度 | Open |

## Knowledge Promotion

- 是否形成 Pitfall：暂不新增；已由 Closure Gate 的冻结规则覆盖，待修复后判断是否需要独立条目；
- 是否需要 ADR：否，不改变防篡改原则；
- 是否更新 Architecture/Runbook：BL-0031 实现时更新 Task Runtime Architecture、Runbook 与 CLI 操作说明。
