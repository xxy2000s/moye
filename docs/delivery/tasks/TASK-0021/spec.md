# TASK-0021 Spec：接通真实 Core 单任务全流程与 Web 全程审计

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：BL-0022、BL-0019

## 用户目标

用户下一次提交一个真实研发任务后，只依赖 Moye Web 页面就能从接收开始持续观察到唯一终态，并能核对每个角色、每次实际执行、返工/重规划、验证、Git 和归档的完整细节。产品成功证据不能来自 Fake、Mock 或预设 Scenario。

## Requirements

### REQ-0021-01：统一真实任务入口

- CLI 提供真实 Coding/Core Task 的 `create`、`status` 和 `wait`；
- 查询先解析 `TaskAuthority`，不能把所有 Task ID 固定查询到 `TaskWorkflow`；
- Web/API/CLI 提交相同冻结输入，重复提交不会创建第二个生命周期；
- 当前产品分支最终收敛到主仓库可直接使用的入口。

### REQ-0021-02：真实角色链路

- 至少持久化 Context/Docs、Implementation、Self Review、Verification、independent Review、Merge、Docs Gate、Closure、Archive；
- Docs、Implementation 和 Review 的实际模型调用使用真实 `CODEX_EXEC | CLAUDE_PRINT` Session；
- 每次调用绑定 Role、StepAttempt、Generation、Session、Artifact 和 Evidence Digest；
- 产品请求拒绝 Fake，确定性 Scenario 只保留为控制协议测试。

### REQ-0021-03：Repair 与 Replan 是真实控制动作

- Blocking Implementation Finding 创建新 Generation 的 Implementation Attempt，重新验证和 Review；
- Design/Requirement Finding 创建 Spec Revision N+1，显式失效旧 Evidence，从 Docs/Plan 边界重新执行；
- Self Review、Review Finding 和控制决策均作为 Event/Artifact 展示，不能只写最终摘要；
- Retry、Repair 和 Replan 分别计数并受显式预算限制。

### REQ-0021-04：失败与未知结果收敛

- 确定性失败形成 `FAILED_TERMINAL`，仍固化失败证据并进入独立 Archive；
- 未知 Agent/Verification/Git 结果进入 `WAITING_RECONCILE`，Web 给出确定的阻塞原因和可执行动作；
- CLI/API 能提交带 Evidence 的 Reconcile/Resume，旧 Attempt 不得复活；
- Archive 失败只重试 Archive，不重新运行模型、验证或 Merge。

### REQ-0021-05：Web 全程审计

- Board 从任务接收后立即显示，并实时刷新主状态、Archive 状态和 Event/Projection 一致性；
- 状态机 Definition 只展示实际代码允许的边，History 只展示连续 Domain Event 证明的边；
- 页面显示所有 Role/Agent Session、Attempt Generation、Self Review、Finding、Verification、Checkpoint、Commit、Merge、Docs Impact、Closure 和 Archive Receipt；
- 任一执行仍在进行时，Agent Events 可以增量查看；结束后原始证据可下载且摘要可校验。

### REQ-0021-06：真实验收

- 在普通本地 Git 仓库提交一个非平凡真实 Codex 任务，并从 Web 全程观察；
- 至少实际经过两个不同角色 Session；Repair/Replan 用真实受控任务或真实 Finding 验收，不用 Fake 伪造；
- `npm run check`、真实 Restate E2E、Live Acceptance、Docs Graph 与 Docs Impact Gate 全部通过；
- 验收记录 Task ID、全部 Session、Event sequence、Attempt/Revision、Result/Merge Commit、Closure 与 Archive。

## 非目标

- 本 Task 不实现多 Daemon、Lease/Fencing、远程 Git Provider、鉴权、多租户或生产运营平台；
- 不要求从 Web 页面创建任务，CLI 是本轮稳定写入口，Web 保持只读审计；
- 不把模型质量等同于 Runtime 正确性，所有模型结果仍需 Gate 和可验证证据。

## 完成定义

用户可以用一条 CLI 命令提交真实任务，随后在 Web 上看到从 `RECEIVED` 到 `ARCHIVED` 或已归档失败终态的完整、连续、可下钻事实；不需要调用内部 Restate API，也不会误入 Fake/Scenario 路径。
