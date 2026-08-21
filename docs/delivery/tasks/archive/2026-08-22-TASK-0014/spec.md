# TASK-0014 Spec：统一 Role Agent Attempt 协议

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0015
> 母需求：CORE-REQ-02 / Slice 2

## 目标

在现有 Agent Artifact/Run ID 经验之上，为 Docs、Implementation 和 Review 三种 Core Role 建立统一的 Request、Attempt、Result 和恢复协议。三种角色共享执行外壳与内容寻址机制，但通过判别联合保留各自输出 Schema；后续 Core Workflow 可以只持久化协议对象和 Artifact，不依赖 Agent 会话内存。

## Requirements

### REQ-0014-01：统一 RoleRunRequest

- Request 固定 Task、Spec Revision、Role、Step、Attempt ID、Generation、Input Digest、Scope、Prompt Digest、Runner Kind 和稳定 Run ID；
- Attempt ID 必须与 Role Step 和 Generation 一致；
- 序列化恢复由 Expected Run ID 校验，任何身份或输入篡改均拒绝；
- Docs、Implementation、Review 使用同一创建与解析入口。

### REQ-0014-02：独立 Attempt 与单 Active 边界

- 每次实际执行创建独立 Role Attempt，终态 Attempt 不得复活；
- Retry 创建连续 Generation N+1，并保留旧 Attempt 结果；
- Core Projection 的 Pending Role Dispatch 是唯一可创建 Attempt 的来源，Role 或 Generation 不匹配时拒绝；
- 一个 Projection 存在 Pending/Active Role 时不能派发第二 Role，沿用 TASK-0013 的 Reducer 不变量。

### REQ-0014-03：角色输出 Schema 与 Artifact

- Docs Result 分为 Spec/Plan/Design 和最终 Docs Impact/Knowledge Sync 两种阶段；
- Implementation Result 必须包含 Result Commit、Checkpoint、Tests 和 Self Review Artifact；
- Review Result 必须包含 ReviewResult Artifact，并表达 `PASSED | FINDINGS`；
- RoleRunResult 固定 Outcome、错误分类、可选 Session、Artifact Manifest、角色输出和 Result Digest；
- Result Artifact 与 Producer Tuple、Request 和 Expected Digest 不匹配时拒绝。

### REQ-0014-04：恢复与昂贵 Run 去重

- Role Run 开始前保存稳定 Execution Intent；
- 完整 Manifest 已存在时直接恢复并复用，不再次调用 Runner；
- Intent 存在但结果不完整时返回 `UNKNOWN_SIDE_EFFECT`，不得盲目启动第二 Run；
- Fake Role Runner 计数测试证明 Worker/Runner 重建后已确认 Run 只执行一次。

### REQ-0014-05：兼容与验证

- 现有单 Agent Coding Workflow、Codex/Claude/Fake Runner 和 Artifact API 不回退；
- 单测覆盖三 Role、Attempt Retry、终态复活、Schema 缺失、篡改、重复恢复、UNKNOWN 和路径边界；
- `npm run check`、真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 本 Task 不让真实 Docs/Review 模型修改仓库，也不实现 Review Finding 生命周期；
- 不推进 Core Workflow 到 Verification、Repair、Replan 或 Closure；
- 不引入多 Active Attempt、多 Daemon、Lease/Fencing 或远程 Artifact Store。

## 完成定义

三个 Role 能用同一协议生成、持久化、解析和恢复各自结果；Implementation 强制 Self Review，Review 输出独立 Verdict；已确认的昂贵 Run 在新 Runner 实例中复用，未知结果停止对账；全量回归和文档门禁通过。
