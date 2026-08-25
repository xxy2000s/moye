# TASK-0066 Spec

> 状态：Approved
> Milestone：M2-W01
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

冻结 Framework MVP 的公共包边界、版本体系、兼容窗口、Workflow 升级规则、RC/GA 渠道与发布身份，使后续 Manifest、CLI、Plugin、分发和发版 Task 都由同一份 Accepted 决策约束。

## Requirements

- `REQ-0066-01`：公共边界必须区分 Core Contract、Client、CLI、Plugin SDK 与私有 Restate Runtime，且不暴露 Projection 写入口或内部 Workflow Input。
- `REQ-0066-02`：冻结首发版本、SemVer 规则、Manifest/Schema/Plugin API 版本与兼容窗口。
- `REQ-0066-03`：定义运行中 Workflow、已归档 Evidence 与项目 Manifest 的升级/拒绝策略，不允许静默重跑昂贵副作用。
- `REQ-0066-04`：定义唯一 Release Identity、RC/GA 渠道、Git/npm/Container 版本一致性和 UNKNOWN 发布回执对账规则。
- `REQ-0066-05`：明确默认隐私、安全边界和 Framework MVP 不包含的生产平台能力。
- `REQ-0066-06`：ADR、Architecture、Roadmap/README、Milestone 和 Document Graph 保持一致，并通过文档门禁。

## 非目标

- 不在本 Task 实现 Manifest、CLI、Plugin SDK、容器或发布流水线。
- 不承诺远程 SCM、Auth/RBAC、多租户、生产 Sandbox、HA 或跨节点 Artifact Store。
- 不执行 npm、GitHub Release 或容器 Registry 发布。
