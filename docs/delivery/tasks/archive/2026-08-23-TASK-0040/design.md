# TASK-0040 Design

Core v2 Lifecycle 增加显式失败收束状态与 append-only 事实：`FAILED_TERMINAL → FAILURE_CLOSURE_REQUIRED → ARCHIVE_PENDING → CLOSED`，并保存 Failure Artifact、Knowledge Disposition、Closure Outcome 与 Archive Receipt。失败原因在首次终止时冻结；后续 Archive 重试只读取冻结 Closure，不允许回到 Agent、Test 或 Merge 状态。

新 Workflow 在自身 `catch` 内完成失败 Closure 和 Archive。文件型失败 Artifact/Archive Receipt 使用 Task、Spec Revision、source Workflow 与 Closure Digest 形成稳定 identity，写入采用 content-checked pending/rename，重复调用只复用相同内容。

历史 LIVE-001～004 不能改写已完成的 `CoreV2Workflow/<task_id>`。新增 `CoreV2FailureRecoveryWorkflow/<task_id>`，先读取并校验 source Projection 确实是未归档的 `FAILED_TERMINAL`，再通过 `TaskAuthority.beginCoreV2FailureRecovery` 原子登记唯一 successor。successor 只执行 Failure Closure/Archive，并把 source Workflow Ref、source Projection Digest、原 Attempts/Sessions/Events 引用写入 Closure；它不创建新的 Role Attempt。

Board、CLI 和 Trace 通过 TaskAuthority 选择当前合法 Core v2 successor；直接查询原 Workflow 仍返回原始失败投影。ProjectBoard 更新只来自 recovery Workflow 的正常 `upsertTask`，不提供修改归档字段的管理接口。
