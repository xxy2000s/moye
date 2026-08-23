# Core v2 Test Assessment Finding 会以 Invalid Output 绕过 Repair

> 文档类型：Finding  
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23  
> 影响范围：TEST_VERIFICATION、Role Runtime v2、Test Finding、Repair

## 观察

真实 Task `TASK-CORE-V2-FAILURE-CLOSURE-001` 的 Trusted Runner 按授权 argv 执行并记录非零退出结果，随后真实 `TEST_ASSESSMENT` Session 返回的结构没有通过 Role Runtime Output Gate。Attempt 因而成为 `INVALID_OUTPUT`，`workflowAcceptTestAssessmentV2()` 在形成 `Test Report → REPAIR_REQUIRED` 前以 Attempt binding 错误终止。

Task 已由新的 Failure Closure/Archive 路径正确收束，没有丢失 Session、Runner Manifest 或失败原因；但它没有验证预期的“真实 Test Finding → Repair Generation N+1”路径。

## 证据

- Task：`TASK-CORE-V2-FAILURE-CLOSURE-001`；
- 重现 Task：`TASK-ACCEPT-20260823111330-01-TEST-FAILURE`；
- Test Assessment Session：`01a02d41-4411-72a0-9f5b-dd6e1cca8813`；
- Trusted Runner Manifest Digest：`sha256:631b0ee56bc4d61f01d1682eb063948fc48b04b803a684284706db1553c9794f`；
- 失败原因：`TEST_VERIFICATION/TEST_ASSESSMENT Attempt does not bind the current Task Revision`；
- Failure Closure Digest：`sha256:8e5691c957c323dff85e9c12a7050cc622791e05963ee7a5ad81c35ad7b6d372`；
- Archive Receipt Digest：`sha256:22edca96d2b3ba0e4fe92aa7c40fb507cacf157f647ead5ae3172f34bbc461e5`。

该问题进入 [BL-0043](../../delivery/backlog/BL-0043.yaml)，必须在真实 Test Failure 场景验收前修复。

TASK-0043 的第二次真实重现确认具体结构矛盾为：Assessment 返回 `recommendation=FINDINGS`，但 `findingRefs=[]`。修复将稳定 `finding://trusted-test/nonzero-exit` 写入失败 Assessment 指令，Role Runtime 的结构校验没有放宽。

新的真实 Task `TASK-ACCEPT-20260823112507-01-TEST-FAILURE` 已完成 `FAILED Manifest → Test Report FINDINGS → REPAIR → PASS`：Generation 0 的 `npm test` 退出码为 17，Manifest Digest 为 `sha256:6872dfa7e6a87548f1b98f61eb6cf674b4a7826a86c433288fac54ea5371a9f8`；Generation 1 退出码为 0，Manifest Digest 为 `sha256:e3cd9ec5fe8062f0bf2e875e5062d8e2f0f80c0908800fb9d88637a8a2a3d988`。最终 Gate、Closure 与 Archive 分别为 `sha256:36f198d5b95f9fe42ee0a59a893a5ec4d894d522c708767d1b6fa11198844b9d`、`sha256:e47eee6bb5e87f28b5adb2253617627f3dc08ae70fa7795fe599c415655635cb`、`sha256:c7cb7435717f6a2005ce39cfa176f23db05ecc77295da1b790685903cb3e814b`。
