# Incident：TASK-0032 提交错误 Seal Result Commit Evidence

> 状态：Resolved
> 日期：2026-08-23
> 严重级别：Development task closure blocked
> 负责人：Moye
> 来源或关联 Task：TASK-0032

## Summary

TASK-0032 的正确 Result Commit 是 `72e29ce32433f2de0ea9a08a978f9553e862e11e`，但 `seal-submit` 被人工传入不存在的 `72e29ce61d7c763847972de269bb71cf1d6ced39`。Seal Gate 正确拒绝该对象，原 `SealedTaskWorkflow/TASK-0032` 收敛为 `FAILED_TERMINAL + archiveStatus=FAILED`。Git Commit、Task package和测试证据没有损坏。

## Impact

- TASK-0032 的原 Runtime Projection 为失败，不能伪装成功；
- Durable Promise 已消费错误 Evidence，原 Workflow 不能接受第二条 Evidence；
- 后续 Roadmap 必须先建立 append-only successor 并恢复同一 Intent，不能删除 Journal 或重建容器。

## Timeline

| 时间 | 事件 |
|---|---|
| 02:26 | TASK-0032 Result Commit 创建，全库验证通过 |
| 02:26 | 人工把未读取验证的错误完整 SHA 传给 `seal-submit` |
| 02:26 | Gate 的 `git cat-file -e` 拒绝不存在对象，Workflow 收敛为失败终态 |
| 02:27 | 确认真实 HEAD、原 Intent、错误 Evidence 和失败 Projection 均完整保留 |
| 02:35 | 第一个 recovery successor 发现历史 Docs Impact 被当前 Graph Revision 误判并保留失败 |
| 02:44 | 修正为目标 Commit detached-worktree Gate；下一 successor 验证正确 Commit并收敛 `SUCCEEDED + ARCHIVED` |

## Root Cause

CLI 接受调用者提供的完整 SHA；操作过程手工补全了短 SHA，而不是直接使用 `git rev-parse HEAD`。现有 Seal 协议对提交验证失败选择唯一失败终态，但缺少针对“Evidence 本身录入错误”的 append-only recovery successor。

## Resolution

TASK-0032R1 增加只针对 `SEALED_TASK_WORKFLOW + CLOSED/FAILED + evidenceSubmitted` 的 append-only successor。Recovery 验证原 Intent、原错误 Evidence、正确 Commit 的父提交/内容/Docs Impact，并要求正确 Commit 是当前 HEAD 的祖先。历史 Docs Impact 在目标 Commit 的 detached worktree 验证。TaskAuthority 为每个失败 predecessor 只登记一个下一 successor；CLI、Board 和 Trace 读取链尾，原失败 Workflow 与失败 recovery 均保持只读。

最终 TASK-0032 successor Event 1～13 同时保留错误 SHA、第一次 recovery 的 Revision mismatch、第二次 `SealCommitVerified` 与唯一成功归档；正确 Result Commit 为 `72e29ce32433f2de0ea9a08a978f9553e862e11e`。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0041 | Recover / Prevent | append-only Seal Evidence recovery，并让 CLI 从 Git 读取 SHA | Converted to TASK-0032R1 |

## Knowledge Promotion

- Finding：真实故障已由本 Incident 记录，不重复创建 Finding；
- Pitfall：已新增 Durable Runtime Pitfall #15；
- ADR：不放宽两阶段 Seal，不需要新 ADR。
