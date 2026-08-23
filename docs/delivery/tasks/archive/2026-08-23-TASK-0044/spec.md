# TASK-0044 Spec：Core v2 UNKNOWN 回执与 Worker 中断真实验收

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)

- `REQ-0044-01`：真实 Test `UNKNOWN → CONFIRMED`：命令实际完成但回执未确认时进入 `WAITING_RECONCILE`，不得启动第二次命令；
- `REQ-0044-02`：真实 Test `UNKNOWN → NOT_APPLIED`：Intent-only 后等待；错误 token 不解除，相同 Evidence 幂等，冲突 Evidence 拒绝，正确对账后只执行一次测试；
- `REQ-0044-03`：在 Architect、Implementation、Test 与 Final Review 的高风险 durable 边界实施真实 Service SIGKILL/重启，证明已完成 Role/Runner 不重复，Attempt、Session、Checkpoint 和 Artifact 可接管；
- `REQ-0044-04`：Git Candidate Commit 已创建但 Workflow 回执未确认时中断，恢复后按 parent、tree、message/trailer 与 clean worktree 对账，不创建第二个 Candidate；
- `REQ-0044-05`：复验真实 Merge ref 更新回执未知：恢复后先按 Git DAG/ref/marker 对账，得到唯一双父 Merge，不以字段赋值冒充；
- `REQ-0044-06`：每场景使用独立真实 Core v2 Task、Codex Session、Restate Workflow、隔离 Git、真实测试和 Runtime Artifact，保存 Requirement → Execution → Evidence；
- `REQ-0044-07`：故障注入仅允许专用 acceptance Service 显式开启；不得直接修改 Projection、删除 Journal 或重复 Workflow key；
- `REQ-0044-08`：提供非交互可重复的真实 recovery acceptance 入口，成功 Task 均 `CLOSED + SUCCEEDED + ARCHIVED`，通过全库、E2E、Docs Impact 与唯一 Result Commit Seal。

多 Daemon Lease/Fencing 不在本 Task 范围；预算、Observer/Knowledge 与 stale Attempt 由 TASK-0045 处理。
