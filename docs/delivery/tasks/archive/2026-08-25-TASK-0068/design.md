# TASK-0068 Design

> 状态：Approved

`MoyeClient` 接收消费级 `StartProjectTaskRequest`，内部加载/验证 Manifest、执行只读 Git preflight、在用户受管 Runtime Root 下分配 repository 外 Artifact namespace，再构造私有 `CoreV2WorkflowInput` 并只向 keyed Workflow 发送一次。

Client status/watch 先查询 TaskAuthority 再附着 owning Workflow；不缓存 Task 状态。Board URL 只由 `taskId` 编码。CLI 是 Client 的薄适配层，支持 `--json` 默认结构输出和 `open --print` 无副作用模式。

Doctor 只执行只读/可恢复检查，不自动安装 Docker/Agent、不修改 Git、不启动服务；Artifact permission probe 只在受管目录创建并删除唯一探针文件。
