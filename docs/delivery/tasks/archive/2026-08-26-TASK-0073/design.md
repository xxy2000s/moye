# TASK-0073 Design

> 状态：Approved

`examples/` 是消费端 fixture，不属于 Moye Runtime 源码。每个目录可以脱离仓库复制，Manifest 的所有路径只相对该示例 repo；npm 包位置只在验收命令中注入，不写入模板。

统一 acceptance 先消费 W07 真实 tarball，再复制模板、初始化 Git main、安装 tarball 到独立 tool directory，通过其 `moye` bin 验证 Manifest 和三个项目测试。完整多 Agent Runtime 场景统一留给 W09，避免示例 Task 与故障矩阵重复消耗 Agent 但证据语义混淆。
