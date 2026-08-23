# TASK-0040R2 Spec：多级 Sealed Recovery Chain

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0045](../../../backlog/BL-0045.yaml)

- `REQ-0040R2-01`：numbered recovery source 可为第一层 recovery 或前一个 numbered Attempt；
- `REQ-0040R2-02`：source 必须是同 Task 的当前 Authority chain head，错误 service/key/revision 被拒绝；
- `REQ-0040R2-03`：连续失败不得覆盖 predecessor Projection、Event 或 Evidence；
- `REQ-0040R2-04`：真实 Restate E2E 证明至少两段失败后用新 recoveryId 唯一成功；
- `REQ-0040R2-05`：TASK-0040 与 TASK-0040R1 通过合法 successor 收敛，禁止直接写 Projection；
- `REQ-0040R2-06`：TASK-0040R2 使用独立 Result Commit Seal。
