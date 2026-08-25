# TASK-0058R1 Design

不修改原 Runtime 或 rejected Commit。`stageSealedTaskPackage()` 在首次移动和幂等复用 archive package 两条路径上都执行与最终 Result Commit Gate 相同的 Accepted 状态解析；非规范状态在 Git package 移动前失败。

恢复分成三个可审计对象：TASK-0058R1 的防复发 Result Commit；以 TASK-0058 冻结 Base 为唯一 parent 的 corrected sibling Evidence Commit；把 sibling 纳入当前 ancestry 的显式 merge。最后 `SealedTaskRecoveryWorkflow/TASK-0058` 只重验原 Intent 与 corrected Evidence，不执行 W01 实现、测试或 Archive 副作用第二次。
