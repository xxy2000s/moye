# Core v2 Documentation Agent 提前消费 Trusted Test Gate

> 文档类型：Finding
> 状态：Fixed by TASK-0043
> 发现日期：2026-08-23
> Runtime Task：`TASK-ACCEPT-20260823104209-04-TEST-FAILURE`

真实 Test Failure 验收 Task 的 Generation 0 故意保留可由 `npm test` 发现的行为缺陷。Documentation Agent 在自己的只读审计阶段自行运行测试，并把行为不符合验收条件作为 Documentation Finding，导致 Workflow 在 Trusted Runner 前提前进入 REPAIR；因此该 Task 不能作为“真实 Trusted Runner 失败触发 Repair”的通过证据。

该 Finding 不意味着 Documentation 应忽略项目事实，而是验收场景必须明确 Phase ownership：Documentation 负责当前文档事实与 Docs Impact，冻结的行为测试必须由后续 Trusted Runner 执行并由 Test Assessment 解释。TASK-0043 收紧专用 Test Failure acceptance instruction，要求 Documentation 不执行或替代授权测试，仅审计指定文档结构；原 Task 继续保留并归档，新 Workflow key 用于重跑真实测试分支。

修复后真实 Task `TASK-ACCEPT-20260823112507-01-TEST-FAILURE` 的 Generation 0 Documentation 正常通过，随后 Trusted Runner 才执行并得到退出码 17；Test Assessment 形成 Blocking Finding 后进入 Repair，Generation 1 重新执行 Documentation、Trusted Test、Assessment 和 Final Review，并最终归档成功。
