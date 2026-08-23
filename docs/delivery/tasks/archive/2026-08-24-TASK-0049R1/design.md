# TASK-0049R1 Design

> 状态：Accepted

`src/archive/sealed-result-commit.ts#createSealIntent` 已经是生成 Seal Intent 前的只读事实校验器。CLI `seal-start` 在 `send()` 前调用它；owning Workflow 随后仍在第一条 durable command 中调用同一函数，最终 Gate 仍验证 Commit、package、Verification 与 Docs Impact。此变化只把确定性输入错误提前暴露，不改变 TaskAuthority、Workflow、Promise 或 Archive 所有权。

`TASK-0049` 在 Active package 尚未存在时被误提交。其唯一 Invocation 在 `prepare-seal-intent` 失败后以 Failure Output 完成，且发生在 Authority claim、Intent、Projection 与 Board upsert 之前。因此它不能使用只适用于“已持久化 Intent + rejected Evidence”的 Sealed Recovery，也不能被描述为 `FAILED_TERMINAL`。原 Invocation 保留为 Incident 证据；实际实现由新 key `TASK-0049R1` 接管。

Roadmap 是一个 Git 快照，SealedTaskWorkflow Receipt 是实时关闭事实。Roadmap 记录在本 Result Commit 之前已经完成的 Runtime Receipt；最新 Task 自己的未来 Result SHA 不可能写入产生该 SHA 的同一 Commit，因此以明确的 snapshot 截止时间和只读 CLI 查询替代递归自写。既有 archived `task.yaml` 继续保持 `seal_prepared`，不回写历史。
