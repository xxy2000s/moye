# TASK-0029 Design：双层防线与 Successor Recovery

## 1. 两层防线

第一层是无副作用 Preflight：只读 Git 和 Task Manifest，在 CLI 派发前以及 Workflow 首次写入前执行。它阻止已知非法输入创建 Authority、Projection、Event 或 Board 数据。

第二层是 Workflow Terminalization：Preflight 无法证明最终 Verification/Docs Impact/Worktree 等运行期事实，因此 Bootstrap 主分支的所有 Evidence 校验和 Closure 持久化都必须位于 Workflow `try/catch` 中。非控制错误通过 `failTask` 追加唯一终态，再进入原 ArchiveWorkflow。

```text
CLI preflight ──fail──> no dispatch
      │ pass
      ▼
TaskWorkflow preflight ──fail──> invocation failure, no task state
      │ pass
      ▼
claim → RECEIVED → EXECUTING → verify/persist
                              └─ deterministic failure
                                 → failTask → failure artifact → ArchiveWorkflow
```

## 2. Preflight 契约

Preflight 返回稳定收据：Task ID、Manifest ref、Introduction Commit、Introduction Parent、Base Commit 和 Receipt Digest。最终 Evidence 校验复用同一核心检查，避免 CLI 与 Runtime 规则漂移。

所有 Git 命令使用 argv 方式执行；路径固定在 `docs/delivery/tasks/<task_id>/task.yaml`，并经过 containment 和 realpath 检查。

## 3. Failure Artifact

失败 Artifact 保存 Task/Workflow、原错误 code/category/message、发生阶段、Spec Revision、已记录 Evidence refs 和稳定 Digest。它不宣称测试通过，也不覆盖原 Task 输入。文件写入使用现有稳定 pending→rename 机制，允许 Restate 重放。

## 4. Successor Recovery

已 `completed/failure` 的 Restate Workflow 不能在原 key 上继续执行。恢复使用专用 Workflow，但必须先完成 append-only authority handoff：

1. 读取原 `TaskWorkflow/<task_id>/status`；
2. 确认 Authority 仍为 `TASK_WORKFLOW` 且没有既有 recovery ref；
3. 确认 Projection 为 `EXECUTING`、Archive `NOT_READY`、没有已接受 Bootstrap Evidence；
4. 只读重放冻结基线检查并得到允许恢复的稳定错误 code；
5. `TaskAuthority.beginBootstrapRecovery` 原子写入 successor ref；
6. successor 从原 Event 序列派生新 Projection，追加 Recovery Event 与唯一 `TaskClosed(FAILED_TERMINAL)`；
7. 写 Failure Artifact，并调用现有 ArchiveWorkflow；
8. CLI/Board 查询 Authority 后路由到 successor，同时 Trace 展示原 Workflow ref 与 recovery ref。

Successor 是显式的 Workflow 权威接管，不是第二套隐式状态机。它只允许已知 Bootstrap 冻结故障，未来常规失败必须由修复后的原 TaskWorkflow 自己收敛。

## 5. Archive 正交

Recovery 或常规失败确认 `FAILED_TERMINAL` 后，Archive 仍可单独失败和重试；任何 Archive 状态都不能把业务 Outcome 改成成功，也不能重新执行 Evidence 校验。
