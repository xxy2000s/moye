# TASK-0036 Spec：Test Verification 与 Trusted Runner

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0038](../../../backlog/BL-0038.yaml)

- `REQ-0036-01`：独立 TEST_PLAN Attempt 建立 Requirement → Case → argv 映射；
- `REQ-0036-02`：Trusted Runner 用 `shell:false` 执行真实命令并持久化退出码、输出和摘要；
- `REQ-0036-03`：独立 TEST_ASSESSMENT Attempt 基于真实 Evidence 形成综合 TEST_REPORT；
- `REQ-0036-04`：PASS 进入 Final Review，FINDINGS 进入 Repair，INCONCLUSIVE/UNKNOWN 进入 Reconcile；
- `REQ-0036-05`：已有 Intent 而无 Manifest 时不得盲目启动第二次测试。
