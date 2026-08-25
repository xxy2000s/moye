# TASK-0058R1 Spec：TASK-0058 Seal Recovery

> 状态：Accepted
> Spec Revision：1

- `REQ-0058R1-01`：保留 TASK-0058 rejected Commit、FAILED_TERMINAL、ArchiveFailed、Intent、Evidence 和 Event；
- `REQ-0058R1-02`：`seal-stage` 在移动目录前校验 Verification 包含精确 `> 状态：Accepted`，失败时 Active package 保持原位；
- `REQ-0058R1-03`：生成原冻结 Base 的 corrected sibling Commit，只修正原 Verification 机器状态；
- `REQ-0058R1-04`：corrected sibling 进入主线 ancestry 后，通过 append-only successor 使 TASK-0058 唯一收敛为 `SUCCEEDED + ARCHIVED`；
- `REQ-0058R1-05`：TASK-0058R1 自身形成独立 Result Commit、Seal 和 Archive。
