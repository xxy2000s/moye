# TASK-0042R1 Spec：TASK-0042 Seal Recovery

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0049](../../../backlog/BL-0049.yaml)

- `REQ-0042R1-01`：保留原 Result Commit `a0501f7…`、失败 Workflow、Intent、错误 Evidence 与全部 Event；
- `REQ-0042R1-02`：corrected sibling Commit 的 parent 仍为原冻结 Base，只把 Verification 状态行改为规范 `Accepted`，原验收说明和证据不得丢失；
- `REQ-0042R1-03`：corrected Commit 必须进入当前 HEAD ancestry 后才启动 successor，Recovery 重验原 token、路径与 Docs Impact；
- `REQ-0042R1-04`：TASK-0042 最终由 Authority 解析为唯一 `SUCCEEDED + ARCHIVED`，原失败仍可审计；
- `REQ-0042R1-05`：TASK-0042R1 使用自己的 Workflow、Intent 和独立 Result Commit 完成 Seal。
