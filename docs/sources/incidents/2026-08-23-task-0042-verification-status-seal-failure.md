# TASK-0042 Verification 状态格式导致 Seal 失败

> 文档类型：Incident
> 状态：Recovering through append-only successor
> 发生日期：2026-08-23
> 影响范围：TASK-0042、Sealed Result Commit、Verification Gate

## 时间线

- `09:49:59Z`：创建唯一 Result Commit `a0501f75eff690b51fab3242a937145d99e2f9c3`，parent 为冻结 Base `34c07dc524829c998d0596f74b0030c3450d79c6`；
- `09:50:11Z`：`SealedTaskWorkflow/TASK-0042` 接收该 Commit 的冻结 token；
- Gate 读取 `verification.md`，发现状态行为 `> 状态：Accepted（Seal Pending）`，不符合只接受规范化 `> 状态：Accepted` 的协议；
- 原 Workflow 正确形成 `FAILED_TERMINAL + ArchiveFailed`，rejected Commit、Intent、Evidence 与 Event 均保留；
- 创建 BL-0049 / TASK-0042R1，准备 corrected sibling Result Commit，并在其进入主线 ancestry 后通过 `SealedTaskRecoveryWorkflow/TASK-0042` 重验原 Intent。

## 根因与处置

TASK-0042 的自然语言状态说明把额外 Seal 阶段文字写入机器门禁字段。仓库已有 TASK-0040R1 同类教训，但最终 Seal 前检查只运行了 Markdown/Docs Impact/测试门禁，没有直接复用 Seal Verification 状态解析器，导致重复触发。

不得 amend `a0501f7…`、重交同一 Workflow key、删除失败 Event 或改写 Projection。恢复提交只把原 Verification 状态修正为规范值；说明文字保留在下一行。TASK-0042R1 使用独立 Result Commit 和 Seal，原 TASK-0042 只由 append-only successor 收敛。

工作项：[BL-0049](../../delivery/backlog/BL-0049.yaml)。
