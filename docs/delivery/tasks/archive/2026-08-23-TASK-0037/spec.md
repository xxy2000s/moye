# TASK-0037 Spec：Final Review 与 Verification Gate

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0039](../../../backlog/BL-0039.yaml)

- `REQ-0037-01`：FINAL_REVIEW 是隔离 REVIEW Attempt，精确绑定 Docs Impact 与 Test Report；
- `REQ-0037-02`：Finding 进入 Repair，PASSED 只进入确定性 Gate；
- `REQ-0037-03`：Gate 重建八类必需 Artifact 的 Task/Revision/Commit/Digest/依赖；
- `REQ-0037-04`：旧 Revision、旧 Candidate 或缺项不能通过；
- `REQ-0037-05`：只有 Gate 通过才进入 Merge。
