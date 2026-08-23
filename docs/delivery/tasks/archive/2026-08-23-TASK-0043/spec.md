# TASK-0043 Spec：真实 Agent Finding 与 Replan 产品验收矩阵

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)

- `REQ-0043-01`：新增可重复、非交互的 `acceptance:core-v2` 与 `acceptance:core-v2:faults` 入口；产品通过证据必须来自真实 Codex/Claude、真实 Restate、隔离 Git、真实 Commit/Merge、Trusted Runner 和 Runtime Artifact；
- `REQ-0043-02`：独立真实 Happy Path Task 完成五类主 Agent、两次 Review、两阶段 Test、Verification Gate、Merge、Closure 与 Archive；
- `REQ-0043-03`：Implementation Self Review Finding 形成真实 Generation 0 缺陷和终态 Candidate，授权 Generation 1 修复；后续 Docs/Test/Final Review 只绑定新 Candidate；
- `REQ-0043-04`：Final Review Finding 在 Generation 0 初步测试通过后形成 Blocking Finding，Generation 1 修复；旧 Review Evidence 不得通过新 Gate；
- `REQ-0043-05`：Documentation Finding 与真实 Test Failure 分别进入 REPAIR；每次新 Generation 都重新执行 Documentation、Trusted Test、Assessment 与 Final Review，不绕过 Docs Impact/Test Gate；
- `REQ-0043-06`：Design Review 在 Revision 1 形成 REPLAN，Revision 2 重新执行 Architect/Design Review；R1 Artifact 和 Evidence 显式 invalidated 且不能通过 R2 Gate；
- `REQ-0043-07`：受控验收条件只能改变真实 Agent 指令，必须显式环境授权；不得替换 Agent、Runner、Git、Restate、Effect、Gate 或 Artifact，也不得计入 Fake/Mock Evidence；
- `REQ-0043-08`：每场景保存 Requirement → Scenario → Test → Execution → Evidence 映射，并证明无重复测试、Commit/Merge 或越代 Evidence；
- `REQ-0043-09`：所有场景最终 `CLOSED + SUCCEEDED + ARCHIVED`，自动门禁与 Docs Impact 通过，TASK-0043 使用唯一 Result Commit Seal。
