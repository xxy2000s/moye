# TASK-0032R1 Spec：Seal Evidence Recovery

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0041](../../../backlog/BL-0041.yaml)
> Incident：[wrong Seal Result Commit Evidence](../../../../sources/incidents/2026-08-23-wrong-seal-result-commit-evidence.md)

## 需求

- `REQ-0032R1-01`：原失败 Workflow、错误 Evidence 和 Event 不得改写或删除；
- `REQ-0032R1-02`：TaskAuthority 对每个失败 predecessor 只允许一个下一 append-only recovery successor，失败 recovery 不覆盖历史；
- `REQ-0032R1-03`：Recovery 重新验证同一 Intent 的正确历史 Commit、唯一父提交、提交内容、Verification、Docs Impact 与 changed paths；
- `REQ-0032R1-04`：正确 Commit 必须是当前 HEAD 的祖先，不能用任意分叉历史冒充；
- `REQ-0032R1-05`：CLI、Board、Trace 默认读取 successor，并暴露 source Workflow ref；
- `REQ-0032R1-06`：真实 Restate 恢复 TASK-0032，最终唯一 successor 为 `SUCCEEDED + ARCHIVED`。
- `REQ-0032R1-07`：历史 Docs Impact 在目标 Commit 自身图谱上验证，不能被当前 Graph Revision 误判。
