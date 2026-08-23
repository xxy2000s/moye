# TASK-0041 Spec：Core v2 真实 Merge Effect

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)

- `REQ-0041-01`：Core v2 只能用 Verification Gate 授权的 Candidate 创建真实双父 Merge Commit，并 CAS 更新明确 target ref；
- `REQ-0041-02`：`mergeCommit` 必须与 `candidateCommit` 不同，且 parent/tree/message/effect marker 可对账；
- `REQ-0041-03`：ref 更新成功但回执丢失后，恢复必须先读取 Git 事实并返回同一 Merge Commit，不执行第二次 update-ref；
- `REQ-0041-04`：target drift、重复 marker、错误 parent/source、checked-out target 被确定性拒绝；
- `REQ-0041-05`：Merge Receipt 的 effectId、outcome、target、commit、reconciled flag 进入 Lifecycle/Board/Trace；
- `REQ-0041-06`：真实 Restate + Git E2E 证明 worker 强杀恢复后唯一 ref 结果和唯一 marker；
- `REQ-0041-07`：TASK-0041 通过独立 Result Commit Seal。

真实验收中确认并纳入同一 Task 的边界修复：Role scope 必须 canonicalize；共享 Artifact Root 必须按 Task 隔离；Trusted Test stdout/stderr Digest 必须绑定文件原始字节；Final Review 必须明确处于 Merge 前。durable command successor recovery 和真实 Success Archive Receipt 不在本 Task 冒充完成，分别进入 BL-0046/BL-0047。
