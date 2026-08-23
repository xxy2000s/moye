# Core v2 真实 Agent 故障矩阵证据不完整

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23  
> 影响范围：Core v2 Workflow、Role Runtime、Effect、Reconcile、验收与文档

## 观察

LIVE-005 与 LIVE-006 使用真实 Codex、Restate、Git 和受信任测试完成了 Happy Path，但 Repair、Replan、Test UNKNOWN、进程中断、Git/Merge 回执未知、预算耗尽、Observer 故障与 stale Attempt 等分支，现有证据主要来自单元测试、确定性 Adapter 或局部 E2E。

TASK-0039 的需求覆盖这些分支，但其 Verification 没有为每个分支保存与 LIVE-006 同等级的真实 Runtime Task、Role Session、Git/Runner Manifest、Gate Digest 和 Archive Receipt。当前成功 Closure 还把 `candidateCommit` 直接作为 `mergeCommit`，不能证明真实目标分支更新 Effect。

## 影响

- 不能声称“完整故障矩阵已完成”或“Core 已完全闭环”；
- 无法证明未知外部副作用不会重复执行；
- 无法证明旧 Revision、Generation 或 Attempt 的迟到 Evidence 必然被拒绝；
- 自动化验收没有 Requirement → Scenario → Execution → Evidence 的完整登记入口。

后续工作进入 [BL-0043](../../delivery/backlog/BL-0043.yaml)。
