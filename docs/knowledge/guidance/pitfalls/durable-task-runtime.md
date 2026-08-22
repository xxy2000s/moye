# Durable Task Runtime Pitfalls

> 状态：Active
> 更新日期：2026-08-23
> 关联设计：[Task Runtime Kernel](../../current/architecture/task-runtime-kernel.md)

## 1. 使用 Trace 作为业务状态

- 触发：使用 `trace_id` 作为跨天 Task 的唯一关联和恢复依据。
- 后果：采样、截断或保留期结束后无法恢复和审计。
- 检测：状态迁移只能从 Trace 后端查询得到。
- 规避：`task_id` 和 Domain Event 是业务关联；Trace 只负责技术诊断。

## 2. 把 Attempt 失败等同于 Task 失败

- 触发：Worker 返回错误后直接把 Task 设置为 `FAILED`。
- 后果：无法区分基础设施重试、实现修复和重新规划。
- 检测：Task 状态迁移逻辑直接依赖一次异常。
- 规避：先分类错误，再由 Workflow 决定 Retry、Repair、Replan、Wait 或终止。

## 3. 重试旧 Attempt

- 触发：失败后复用同一个 `attempt_id` 和所有权记录。
- 后果：成本、执行者、租约和输出相互覆盖，无法审计。
- 检测：一个 Attempt 存在多次 start/end 或多个 Daemon。
- 规避：每次执行创建新 Attempt，旧 Attempt 保持终态。

## 4. 依赖 Agent 隐藏上下文交接

- 触发：恢复需要旧模型 Session、聊天历史或进程内对象。
- 后果：旧 Agent 消失后无法接管，也无法解释决策。
- 检测：新 Agent 无法仅根据持久化数据继续。
- 规避：持久化 TaskEnvelope、决策摘要、Tool Result、Checkpoint 和下一步约束。

## 5. 把本地 Worktree 当作持久状态

- 触发：Task 只记录某台 Daemon 上的本地路径。
- 后果：机器丢失后代码现场无法迁移。
- 检测：恢复流程必须访问旧机器文件系统。
- 规避：保存 checkpoint commit、dirty patch、untracked Artifact 和 tree digest。

## 6. 未知副作用盲目重试

- 触发：Push、PR 或 Merge 超时后立即重新发送请求。
- 后果：重复操作、状态分叉或错误合并。
- 检测：外部写操作没有 `UNKNOWN` 和 Reconcile 状态。
- 规避：使用 Effect Ledger；结果未知时先查询外部事实。

## 7. 多个组件拥有状态机

- 触发：Workflow、数据库状态机和消息队列消费者分别决定下一状态。
- 后果：产生三个互相矛盾的当前状态。
- 检测：多个组件可以直接写 Task 主状态。
- 规避：只有 Workflow 推进主状态，其他系统是投影、执行器或传输层。

## 8. 嵌套重试预算相乘

- 触发：工具、Attempt、Repair、Replan 各自独立重试且没有总预算。
- 后果：一次任务产生不可控模型调用和成本。
- 检测：无法从 Task 查询累计次数、Token、成本和时长。
- 规避：Workflow 维护中央 Budget Ledger，每次重试先申请预算。

## 9. 用一个超长 Trace 覆盖完整 Task

- 触发：让一个 Trace 跨越数小时或数天并包含所有异步等待。
- 后果：后端查询、采样和展示不可靠。
- 检测：Task 只有一个长期不结束的 root span。
- 规避：每个 Attempt 或短执行单元建立 Trace，使用 `task.id` 和 Span Links 关联。

## 10. PoC 同时解决所有领域

- 触发：第一版同时实现多 Agent、生产 Sandbox、知识库、完整 Git 平台和高可用集群。
- 后果：最关键的恢复语义迟迟无法得到验证。
- 检测：任何一个 PoC 验收条件都依赖大量无关平台组件。
- 规避：第一轮只验证 Durable Step、中断接管、Checkpoint、Effect 和 Trace。

## 11. 只给最终目录移动加幂等，忽略准备步骤

- 触发：Manifest 使用随机临时文件写入，进程中断后重试直接生成另一个临时文件。
- 后果：遗留文件进入目录摘要，冻结结果发生漂移，Archive 无法判断哪份 Manifest 有效。
- 检测：准备步骤使用 PID/随机数命名临时文件，却没有重启后的 Reconcile 规则。
- 规避：临时文件也使用稳定 operation key；重试先比较其内容，一致则完成原子 rename，不一致则停止为 Conflict。

## 12. 把副作用结果缓存误当成幂等

- 触发：先修改外部状态，再等待 Workflow 记录 Step Result；中间进程退出。
- 后果：重放 Step 时再次修改外部状态。
- 检测：副作用函数只有计数/写入，没有稳定 idempotency key 或 ledger。
- 规避：外部系统支持时传稳定幂等键；本地样例以 operation ledger 为事实并从 ledger 重建计数投影。

## 13. 把容器可写层当作 Runtime 持久化

- 触发：用 `docker run --rm` 或无 `/restate-data` 挂载的容器承载 Restate，随后停止、删除或重建容器。
- 后果：ProjectBoard Projection、Workflow Journal 和 Domain Event 随容器消失；Git Task Archive 仍在，但不能原样重建运行时执行历史。
- 检测：`docker inspect` 中 `/restate-data` 没有 Mount，或 Compose 配置中 Restate 没有命名卷/绑定卷。
- 规避：标准本地入口使用 `npm run runtime:up`，把 `/restate-data` 挂载到 `moye_restate_data`；日常停止只用 `runtime:down`，不执行 `down -v`。Git Archive 与 Runtime Projection 分别审计，禁止页面扫描目录伪造 History。

## 14. 在 Projection 已推进后才验证不可变 Bootstrap 基线

- 触发：先 claim Authority 并写入 `RECEIVED/EXECUTING`，直到 Closure 才检查 Manifest 首次引入提交和 `base_commit`。
- 后果：Gate 正确拒绝证据，但 Workflow Invocation 已完成失败，业务 Projection 永久停在非终态；Restate Workflow 又不能 restart-as-new。
- 检测：`sys_invocation` 为 `completed/failure`，而同 key shared status 仍是 `EXECUTING/NOT_READY`；Board 和 Invocation 结论分离。
- 规避：CLI 与 Workflow 首次状态写入前复用同一只读 Preflight，最终 Gate 再校验；进入 Projection 后的确定性错误必须在 Workflow 内 terminalize。历史遗留只能通过核对原 Invocation 的 append-only successor recovery 收敛，不能 purge、patch state 或直接改 Board。
