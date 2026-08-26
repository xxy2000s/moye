# TASK-0075 Spec

> 状态：Approved
> Milestone：M2-W10
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)、[BL-0081](../../../backlog/BL-0081.yaml)

## 目标

把已通过真实外部项目矩阵的 Framework MVP 冻结为 `moye@0.1.0` GA：形成精确 Release Identity、可重复本地发布产物、外部发布/对账回执、发布后 clean-install 验证和最终可验收服务，同时准确交接安全边界与生产限制。

## Requirements

- `REQ-0075-01`：冻结 README、Architecture、CodeMap、Runbook、Security、Migration、Known Limitations 与 Release Notes，所有声明不超过 M1/M2 真实证据。
- `REQ-0075-02`：`npm run check`、`npm run test:e2e`、M1 Session Evidence 与 M2 Framework Product Matrix 的最终证据均可查询且通过。
- `REQ-0075-03`：从唯一 W10 Result Commit 构建 `0.1.0` npm tarball、非 root Service image、CycloneDX SBOM 与 canonical GA Release Manifest；版本、Commit 与 Digest 一致。
- `REQ-0075-04`：Git Tag、GitHub Release、npm publish 与容器 push 在执行前按唯一 Release Identity 对账；相同字节幂等确认，不同字节冲突拒绝，缺少权限时形成明确外部阻塞而不伪造回执。
- `REQ-0075-05`：发布产物在隔离目录完成 clean-install CLI/exports/Schema smoke；最终 Service 以 GA identity 启动在 `http://127.0.0.1:3000`。
- `REQ-0075-06`：TASK-0066～0075 均有唯一 Result Commit 与 Runtime Archive 事实；最终报告给出版本、Tag、Release/Registry 状态、产物 Digest、验收入口和仍未实现的生产能力。

## 非目标

- 不在本 Task 实现远程 SCM/PR、多节点调度、Auth/RBAC、多租户、生产 Sandbox/Secrets、远端 Artifact Store、HA/SLO 或灾备。
- 不因外部 Registry 缺少凭证而修改包名、覆盖既有版本/Tag，或把本地产物冒充公开发布。
