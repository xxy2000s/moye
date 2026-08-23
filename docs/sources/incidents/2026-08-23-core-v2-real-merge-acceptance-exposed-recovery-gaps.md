# Incident：Core v2 真实 Merge 验收连续暴露 durable command 收敛缺口

> 状态：Mitigated / Follow-up Required
> 日期：2026-08-23
> 严重级别：Core v2 acceptance blocked
> 负责人：Moye
> 来源或关联 Task：TASK-0041、TASK-CORE-V2-MERGE-UNKNOWN-001～005

## Summary

TASK-0041 以真实 Codex、Restate、隔离 Git 和 Trusted Runner 验收 Merge ref 更新回执丢失。前四个独立 Runtime Task 分别暴露 Role `/tmp` canonicalization、共享 Failure Artifact 文件、Trusted Test 文件 Digest 和 durable command failure recovery 问题；第五个 Task 最终完成唯一双父 Merge 与 `ALREADY_APPLIED` 对账。所有失败历史均保留，没有复用 Workflow key 或修改 Projection。

## Impact

- `...-001`、`...-003`、`...-004` 的原 Workflow 因 journaled command failure 尚未完成失败 Archive；
- `...-002` 已通过失败 Closure/Archive，证明 Architect Artifact 结构错误能形成业务失败终态；
- `...-005` 已证明真实 Merge/Reconcile，但成功路径缺少真实 Archive Receipt；
- 完整十五场景矩阵仍未完成，不能宣布 Core 完全闭环。

## Timeline

| Task | 真实结果 |
|---|---|
| `...-001` | `/tmp` 逻辑路径被 physical-only Role Gate 拒绝，Journal 停在 Architect command |
| `...-002` | Architect 返回 scalar acceptance criterion；严格 Gate 拒绝并完成失败归档 |
| `...-003` | 七个 Role 执行到 Final Review；Failure Artifact 与前 Task 共用文件而冲突 |
| `...-004` | Final Reviewer发现 Trusted Test 文件 Digest 不一致并进入 Repair；无代码变化的 checkpoint command 失败 |
| `...-005` | 七个 Role 全通过；`update-ref` 后 Service exit 76；重启后对账为同一 `ALREADY_APPLIED` Merge |

## Root Cause

产品 Happy Path 之前没有用多个真实 Task 共用 Artifact Root、重新计算 Evidence 文件摘要，也没有在 `ctx.run` command 自身失败后验证外层 Closure 是否仍可执行。成功 Closure 同时把 Archive Event 当成 Archive Effect 的替代品。

## Resolution

TASK-0041 已修复路径 canonicalization、Task-scoped Failure Artifact、原始文件 Digest 校验、Final Review 的 Merge 前职责边界，并接入真实双父 Merge/Reconcile Receipt。遗留 Task 的合法收敛进入 BL-0046；成功 Closure/Archive Effect 进入 BL-0047。

## Evidence

- 成功 Task：`TASK-CORE-V2-MERGE-UNKNOWN-005`；Invocation `inv_1bucrBJ0vHpE2HRWsoEOIrnJjQLl3E0Ng4`；
- Candidate：`c79abb3aa3332b326427ed6f8934b05cc7bedede`；
- Merge：`6f944eb869f6123b10a0d976915bb919b04775db`，parents 为 frozen base 与 Candidate；
- Merge Receipt Digest：`sha256:48cec48677226217971ee835c43aed66788b531e5ffc8864c51ca9542f547d26`；
- 七个 Role Attempt/Session 全部唯一；ref-update marker 一行，匹配唯一 Merge；
- 失败和修复来源：四份关联 Finding 与 BL-0043/0046/0047。

## Backlog Outputs

| Backlog | 说明 |
|---|---|
| BL-0043 | 继续真实 Agent 故障矩阵 |
| BL-0046 | journaled durable command 的 append-only recovery successor |
| BL-0047 | 成功 Closure 与真实 Archive Effect |

## Knowledge Promotion

- Pitfall：新增共享 Artifact Root 与 journaled command catch 两项；
- ADR：否，沿用 Workflow/Authority/append-only recovery 不变量；
- Architecture/Runbook：TASK-0041 同步更新。
