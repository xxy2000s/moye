# Finding：Minimal Git Recovery 验收文字仍硬编码 npm test

> 状态：Resolved
> 发现日期：2026-08-26
> 来源：TASK-0074 真实 Minimal Git UNKNOWN→NOT_APPLIED 场景
> 处置：[BL-0078](../../delivery/backlog/BL-0078.yaml) → TASK-0074

## 观察事实

`TASK-RCV-20260826015759-01-TEST-NOT-APPLIED` 的真实测试 argv 已是 `git diff --check HEAD`，且 Intent-only 中断、`WAITING_RECONCILE`、`NOT_APPLIED` 与单次执行均已发生；但 Task Input 的第 4 条 acceptance criterion 仍写成 `Trusted Runner executes npm test`。Final Reviewer 正确产生 `FINAL_REVIEW-REQ-4-TRUSTED-NPM-TEST-NOT-EXECUTED` 并授权了非目标 Repair。

## 根因

Recovery Harness 参数化了 Test Command，却没有从同一 argv 派生面向 Reviewer 的验收文字，导致 Requirement、Execution 与 Evidence 自相矛盾。

## 修复

TASK-0074 改为由 `trustedTestArgv` 同时生成 `testCommands` 与 acceptance criterion，并为产品矩阵增加显式 resume root：已通过的真实 Node/Python Task 只复用不可变 Evidence，不重新运行 Agent；修正版 Minimal Git 使用新 Workflow key 重跑。原 Task 继续由 owning Workflow 合法收敛并保留全部 Finding/Repair 历史，但不计为目标场景通过。
