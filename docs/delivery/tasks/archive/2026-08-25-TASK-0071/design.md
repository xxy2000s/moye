# TASK-0071 Design

> 状态：Approved

Runtime Distribution 使用单一 Compose project：Restate 持有业务 Journal，Moye Service 持有只读 Board、Workflow endpoint 和受管 Artifact；两者通过内部网络通信。宿主机只发布 loopback Board、Ingress 和 Admin，Restate 通过容器服务名发现 Moye endpoint。Service 镜像以非 root UID 运行，配置与项目目录使用显式只读/读写挂载，不从宿主机隐式扫描凭证。

健康模型分两层：`/healthz` 只证明进程事件循环可响应；`/readyz` 对 Restate Ingress/Admin 做有界探测并返回稳定的结构化状态。Compose healthcheck 消费 readiness，Runtime 管理脚本在 `up` 后注册 deployment 并等待就绪。

运维脚本只使用 argv 调用 Compose/Docker：backup 在停止写入窗口中导出命名卷和配置摘要，restore 要求显式空目标或确认过的替代 project；upgrade 先备份、拉取/构建指定版本、重建 Service 并检查既有 Task；rollback 使用已知镜像版本和同一持久卷。默认 uninstall 仅停止并删除容器/网络，数据卷删除必须使用独立显式动作。
