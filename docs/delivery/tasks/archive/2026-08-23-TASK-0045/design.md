# TASK-0045 Design

> 状态：Implemented and verified

`CoreV2Workflow` 增加可选 `observerKnowledge` 配置。Verification Gate 后先用纯函数生成确定性 Observer Report，再创建只读 `OBSERVER_KNOWLEDGE` Attempt。该 Agent 只能提出候选；成功时 Workflow 可记录 `none | proposed`，失败、无效输出或超时记录 `deferred`。无论智能旁路结果如何，只有 Workflow 与确定性 Gate 能继续 Merge/Closure。

Repair/Replan 预算验收复用真实 Workflow 和真实 Agent，通过专用 `acceptanceControl` 让连续 Revision/Generation 产生可观察 Blocking Finding；它不替换 Role Runtime。Workflow 达到已有固定预算后走正式 Failure Closure/Archive，Harness 审计预算后没有新主流程 Agent、测试、Commit 或 Merge。

新增只读 `auditAttemptFence` shared handler。它只能定位 Workflow 已持久化的真实 Attempt/Role Manifest，校验调用方给出的 Manifest Digest，并比较当前 Revision/Generation；结果只返回 `STALE_REVISION | STALE_GENERATION | CURRENT`，不接受外部 Artifact、不调用 Reducer、不写 Projection。Harness 在预算 Task 上使用真实旧 Evidence，比较审计前后 Projection Digest，证明查询不能覆盖 Candidate、Review、Closure 或 Archive。
