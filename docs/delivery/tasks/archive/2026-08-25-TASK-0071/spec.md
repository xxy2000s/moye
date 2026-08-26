# TASK-0071 Spec

> 状态：Approved
> Milestone：M2-W06
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

交付可重复安装和运维的 Moye Service Runtime Distribution：Service 镜像与 Restate 组成完整 Compose，持久保存 Journal、Artifact 与运行配置，并提供健康检查、备份、升级、回滚和卸载的可验证操作路径。

## Requirements

- `REQ-0071-01`：多阶段 Service Dockerfile 只包含运行时所需文件，以非 root 用户启动，并具有确定性 build context。
- `REQ-0071-02`：Compose 同时编排 Restate 和 Moye Service；Board、Ingress、Admin 默认仅绑定 loopback，Service Endpoint 仅通过内部网络暴露给 Restate。
- `REQ-0071-03`：Restate Journal 与 Moye Artifact 使用独立命名卷；普通 stop/restart 不删除数据，破坏性卸载必须显式指定并有预检。
- `REQ-0071-04`：提供 liveness/readiness API 和容器 healthcheck；readiness 必须证明 Service 已启动且可访问 Restate，不把单纯进程存活冒充可用。
- `REQ-0071-05`：配置模板覆盖端口、项目、仓库/Artifact/Session 挂载和可选 Observability，默认不开放公网、不采集敏感内容。
- `REQ-0071-06`：Runbook 与可执行脚本覆盖 logs、backup、restore、upgrade、rollback、uninstall；升级保留既有 Runtime，并对不兼容迁移 fail closed。
- `REQ-0071-07`：真实 Docker 验收证明从零启动、Service 自动注册、健康/就绪通过、创建持久 Task、重启后仍可查询，并能生成与校验备份。

## 非目标

- 不在本 Task 发布 Registry 镜像或 npm 包；由 W07/W10 完成。
- 不在容器内预置用户的 Codex/Claude 凭证、生产 Secrets、远程仓库或多租户隔离。
- 不把 Compose 证明扩大为 HA、灾备或生产 SLO。
