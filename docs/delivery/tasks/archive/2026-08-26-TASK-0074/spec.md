# TASK-0074 Spec

> 状态：Approved
> Milestone：M2-W09
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)、[BL-0077](../../../backlog/BL-0077.yaml)、[BL-0078](../../../backlog/BL-0078.yaml)、[BL-0079](../../../backlog/BL-0079.yaml)

## 目标

建立 Framework MVP 的真实外部项目产品矩阵，逐项绑定 Project、Scenario、Runtime Task、Agent Session、Git/Test/Review/Gate/Closure/Archive Evidence，并证明跨真实代码版本恢复不重复昂贵操作。

## Requirements

- `REQ-0074-01`：Node 外部项目真实完成 Happy 与 Finding-driven Repair。
- `REQ-0074-02`：Python 外部项目由真实 Trusted Runner 产生 Test Failure，Repair 后成功归档。
- `REQ-0074-03`：Minimal Git 外部项目完成 Test UNKNOWN→NOT_APPLIED 对账，错误 token/冲突 evidence 拒绝且测试仅执行一次。
- `REQ-0074-04`：至少一个外部项目形成唯一 FAILED_TERMINAL Failure Closure 与 Archive，不执行 Merge。
- `REQ-0074-05`：运行中真实 Agent Task 从旧 Result Commit Service 中断后由新 Result Commit Service 恢复，已完成 Role/Test/Commit 不重复；已归档 Task 前后 Projection Digest 不变。
- `REQ-0074-06`：从 RC tarball 与 container clean install 重跑；所有场景形成统一 requirement matrix 和页面链接。
- `REQ-0074-07`：矩阵入口自行启动、注册与回收授权正确的专用 Service；Projection 创建前的 Invocation 失败必须立即报告且保留原失败事实。
- `REQ-0074-08`：外部项目的 Test Command 与 Reviewer 验收文字绑定同一 argv；续跑只复用已归档的不可变 Evidence，禁止重复已通过场景的昂贵操作。
- `REQ-0074-09`：跨版本边界必须处理已落盘 Role Manifest 的 `WAITING_RECONCILE`，保存新版本 Commit/Tree 的独立 Git bundle，并使失败后续跑只重试缺失阶段。

## 非目标

- 不把单机双版本恢复外推为多节点调度、长期兼容窗口或最终 Restate 生产选型。
