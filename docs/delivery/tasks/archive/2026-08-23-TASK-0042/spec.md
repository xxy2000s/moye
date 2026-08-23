# TASK-0042 Spec：Core v2 成功归档与停滞命令恢复

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0046](../../../backlog/BL-0046.yaml)、[BL-0047](../../../backlog/BL-0047.yaml)、[BL-0048](../../../backlog/BL-0048.yaml)

- `REQ-0042-01`：成功 Merge 后必须形成内容寻址、不可变的 Success Closure Artifact，绑定最终 Revision、Generation、Candidate、Merge、Verification Gate、Knowledge Disposition 和原 Workflow；
- `REQ-0042-02`：成功 Closure 后只能进入 `ARCHIVE_PENDING → ARCHIVED | ARCHIVE_FAILED`，Archive Receipt 必须包含稳定 Effect ID、Closure Digest、物理 Artifact ref、Receipt Digest 和 outcome；
- `REQ-0042-03`：Archive 失败只能用同一 Effect/Token 重试 Archive，不得重新执行 Agent、Trusted Test、Checkpoint、Verification Gate 或 Merge；
- `REQ-0042-04`：Board/Trace 不得由 `state === CLOSED` 推导 `ARCHIVED`，必须读取真实 Lifecycle Archive Receipt；
- `REQ-0042-05`：append-only Core v2 stalled recovery 只接受可证明处于 journaled durable command failure 的原 Invocation、精确 source Projection Digest 和当前 Authority chain head；
- `REQ-0042-06`：recovery successor 保留原 Workflow、Attempt、Session、Event、失败阶段和原因，只追加 Failure Artifact、Knowledge Disposition、Failure Closure 与 Archive，不重跑主流程 Effect；
- `REQ-0042-07`：`TASK-CORE-V2-MERGE-UNKNOWN-001/003/004` 通过合法 successor 收敛到唯一失败归档终态，原 keyed Workflow 历史保持不变；
- `REQ-0042-08`：真实成功 Core v2 Task 具备 Closure Artifact、Archive Receipt 和 Board/Trace 一致证据；
- `REQ-0042-09`：所有 recovery/Archive 重放幂等，错误 source digest/token 冲突，且 TASK-0042 使用唯一 Result Commit 完成 Seal。
- `REQ-0042-10`：旧 schema 的 Core v2 Recovery Projection 缺失 nullable 字段时，Board/Trace 必须仍可查询且不得改写历史 Projection。
