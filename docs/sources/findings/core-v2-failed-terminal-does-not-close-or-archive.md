# Core v2 失败终态没有完成 Closure 与 Archive

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23  
> 影响范围：Core v2 Workflow、Closure、Archive、ProjectBoard、Trace

## 观察

`CoreV2Workflow` 捕获阶段异常后只把运行投影写成 `FAILED_TERMINAL` 并抛出 `TerminalError`。该路径没有形成失败 Closure Artifact、Knowledge Disposition 或 Archive Receipt，也没有运行可重试的 Archive Effect。

同时，`boardTask()` 只在 Workflow 投影 `state === CLOSED` 时映射 `archiveStatus: ARCHIVED`。因此真实失败的 LIVE-001～LIVE-004 虽然具有原 Workflow、Attempt、Session、Event 和错误信息，却长期显示为“待归档”。

## 可重复证据

1. `src/restate/core-v2-services.ts` 的 `catch` 只写入 `FAILED_TERMINAL`；
2. `src/domain/core-v2-lifecycle.ts` 只有成功 `workflowCloseCoreV2()`，没有失败 Closure/Archive 状态；
3. ProjectBoard 中 LIVE-001～LIVE-004 均为 `outcome=FAILED_TERMINAL`、`archiveStatus=NOT_READY`；
4. 这些 Task 的原始 Session 与 Lifecycle History 仍存在，不能通过直接修改 Projection 修复。

## 影响

- 失败任务没有唯一、可解释、可查询的业务闭环；
- Board 把已确定失败的历史验收任务永久堆在“待归档”；
- Archive 失败无法仅重试 Archive；
- 用户无法区分“业务已失败但归档未执行”和“归档失败”。

后续工作进入 [BL-0042](../../delivery/backlog/BL-0042.yaml)。
