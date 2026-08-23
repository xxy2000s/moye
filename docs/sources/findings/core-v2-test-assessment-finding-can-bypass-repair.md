# Core v2 Test Assessment Finding 会以 Invalid Output 绕过 Repair

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23  
> 影响范围：TEST_VERIFICATION、Role Runtime v2、Test Finding、Repair

## 观察

真实 Task `TASK-CORE-V2-FAILURE-CLOSURE-001` 的 Trusted Runner 按授权 argv 执行并记录非零退出结果，随后真实 `TEST_ASSESSMENT` Session 返回的结构没有通过 Role Runtime Output Gate。Attempt 因而成为 `INVALID_OUTPUT`，`workflowAcceptTestAssessmentV2()` 在形成 `Test Report → REPAIR_REQUIRED` 前以 Attempt binding 错误终止。

Task 已由新的 Failure Closure/Archive 路径正确收束，没有丢失 Session、Runner Manifest 或失败原因；但它没有验证预期的“真实 Test Finding → Repair Generation N+1”路径。

## 证据

- Task：`TASK-CORE-V2-FAILURE-CLOSURE-001`；
- Test Assessment Session：`01a02d41-4411-72a0-9f5b-dd6e1cca8813`；
- Trusted Runner Manifest Digest：`sha256:631b0ee56bc4d61f01d1682eb063948fc48b04b803a684284706db1553c9794f`；
- 失败原因：`TEST_VERIFICATION/TEST_ASSESSMENT Attempt does not bind the current Task Revision`；
- Failure Closure Digest：`sha256:8e5691c957c323dff85e9c12a7050cc622791e05963ee7a5ad81c35ad7b6d372`；
- Archive Receipt Digest：`sha256:22edca96d2b3ba0e4fe92aa7c40fb507cacf157f647ead5ae3172f34bbc461e5`。

该问题进入 [BL-0043](../../delivery/backlog/BL-0043.yaml)，必须在真实 Test Failure 场景验收前修复。
