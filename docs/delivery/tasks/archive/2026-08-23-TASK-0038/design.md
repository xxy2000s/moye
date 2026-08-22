# TASK-0038 Design

确定性 Observer 是纯投影，不是 Agent。智能 Observer/Knowledge 读取该投影后可产生候选，但不拥有状态推进、验证或关闭权限。Workflow 可在 Agent 不可用时写入 `deferred`，因此 Knowledge Artifact 必需而 Agent 非必需。
