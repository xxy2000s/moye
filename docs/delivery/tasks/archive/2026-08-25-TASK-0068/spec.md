# TASK-0068 Spec

> 状态：Approved
> Milestone：M2-W03
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

交付不暴露 CoreV2Workflow Input 的消费级 Client，以及 `doctor`、`task start/status/watch/open` CLI，使外部项目从 Manifest 和自然语言需求启动并追踪真实任务。

## Requirements

- `REQ-0068-01`：Client 公共请求只包含 Manifest、需求、验收标准和可选 Task ID，不暴露 baseCommit/artifactRoot/内部 handler。
- `REQ-0068-02`：start 自动冻结 clean Git HEAD、目标 ref、受信任测试 argv、Runner、受管仓库外 Artifact Root 和唯一 Task ID。
- `REQ-0068-03`：doctor 诊断 Manifest、Git/clean worktree、Agent CLI、测试 executable、Artifact 权限、Docker、Restate/Board 服务并区分 blocking/warning。
- `REQ-0068-04`：status/watch 使用 owning Workflow 查询，open 生成稳定 Board 路由且默认可显式 `--print` 禁止副作用。
- `REQ-0068-05`：Client/CLI 有单元与真实 Runtime 提交证据；重复 Task ID 由 Runtime identity 收敛，不创建第二套状态机。

## 非目标

- 不发布 npm tarball或容器；属于 W06/W07。
- 不实现第三方 Adapter/Documentation Policy；属于 W04/W05。
