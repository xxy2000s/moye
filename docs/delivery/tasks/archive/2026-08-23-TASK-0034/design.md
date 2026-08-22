# TASK-0034 Design

在 `CoreV2LifecycleProjection` 中加入 Implementation Generation 和 append-only Checkpoint 记录。Role Attempt 绑定实现前的稳定 subject commit；成功结果再产生 Candidate Commit。Self Review 是 Implementation 输出的一部分，但 Workflow 独立解释 verdict：通过进入 Documentation，Finding 进入 Repair。Repair 只授权下一 Generation，不删除旧 Evidence。
