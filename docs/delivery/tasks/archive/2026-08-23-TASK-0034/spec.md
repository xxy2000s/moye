# TASK-0034 Spec：Implementation、Self Review 与 Repair

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0036](../../../backlog/BL-0036.yaml)

- `REQ-0034-01`：Workflow 只接受绑定当前 Task、Revision、基线 Commit 的成功 IMPLEMENTATION Attempt；
- `REQ-0034-02`：实现结果记录 Candidate Commit、Checkpoint、测试写入和 Self Review Evidence；
- `REQ-0034-03`：Self Review 通过才进入 Documentation；阻塞 Finding 必须进入 `REPAIR_REQUIRED`；
- `REQ-0034-04`：Repair 显式授权 Generation N+1，旧 Attempt 和 Checkpoint 保持可追踪且不能覆盖新结果；
- `REQ-0034-05`：重复、跳代、错误 Commit 或错误角色结果必须被确定性拒绝。
