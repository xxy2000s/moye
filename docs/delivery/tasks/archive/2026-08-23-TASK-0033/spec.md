# TASK-0033 Spec：Architect 与 Design Review

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0035](../../../backlog/BL-0035.yaml)

- `REQ-0033-01`：Workflow 从成功 ARCHITECT Attempt 生成同 Revision 的 Spec、Design、Plan 一等 Artifact；
- `REQ-0033-02`：DESIGN_REVIEW 是独立 REVIEW Attempt，绑定三个 Architect Artifact 的精确 subject digest；
- `REQ-0033-03`：PASSED 才进入 Implementation；FINDINGS 只能进入 REPLAN_REQUIRED；
- `REQ-0033-04`：REPLAN 提升 Revision R+1，显式失效旧 Revision 全部 Artifact，旧 Attempt 不能满足新 Revision；
- `REQ-0033-05`：Projection 与 Event 内容寻址，非 Workflow 调用不能绕过状态/角色/Commit 绑定。
