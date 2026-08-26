# TASK-0076 Spec

> 状态：Approved
> Backlog：[BL-0082](../../../backlog/BL-0082.yaml)
> Finding：[Core v2 验收 Role Session 未采集](../../../../sources/findings/core-v2-acceptance-role-sessions-not-captured.md)

## 目标

让真实 Core v2 产品/故障验收中的每个 Agent Role 默认产生可由 Board 读取的受管 Session Evidence，并通过正式 append-only enrichment 恢复当前仍可定位 Provider 源文件的历史验收任务；不修改原 Task Projection、不重跑旧 Agent、不伪造已丢失的会话。

## Requirements

- `REQ-0076-01`：真实 Core v2 Happy/Fault/Recovery/Guard/Framework Matrix 默认启用与真实 Runner 匹配的 `sessionEvidence`；Capture 专项场景只增加故障注入，不再是唯一采集场景。
- `REQ-0076-02`：验收 Service 和最终 GA Service 使用显式最小 Provider Session Source allowlist；Artifact Root 仍限制在受管目录，Board 不直接读取 Provider Home。
- `REQ-0076-03`：新增可重复的多 Task Session audit/enrichment 入口，只接受调用方显式 Task ID；逐 Task 验证 owning archived Projection、Role/Attempt/Run/Session、Receipt/Manifest、Board timeline、幂等重放和 source Projection Digest 不变。
- `REQ-0076-04`：`TASK-RCV-20260826114418-01-ROLE-RECOVERY` 的 7 个角色最终均能在页面读取 canonical Timeline；Role Worker 中断历史不被覆盖，也不启动第二次 Agent。
- `REQ-0076-05`：审计 W09 Framework Matrix 的目标 Agent Task；可恢复源形成 `COMPLETE | PARTIAL`，确实缺失源形成可查询 `UNAVAILABLE` disposition，报告不得把 Session ID 计为 Transcript。
- `REQ-0076-06`：`npm run check`、`npm run test:e2e`、定向真实历史恢复和 Board API 验收通过，最终服务继续运行在 `http://127.0.0.1:3000`。
- `REQ-0076-07`：临时 Acceptance Service 退出前必须把其最新 Restate Deployment URI 交回仍运行的前序 Service；不得留下指向死亡进程的最新 revision，不得强制删除 Deployment 或影响在途 Invocation。

## 非目标

- 不修改或补画既有 Core v2 Projection、Role Manifest 和 Domain Event；
- 不恢复 Provider 未保存、已删除或不可解密的内容；
- 不默认开放整个用户目录，不在 Board 返回 Provider 本地绝对路径。
