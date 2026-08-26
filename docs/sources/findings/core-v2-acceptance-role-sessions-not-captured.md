# Core v2 验收任务展示 Session ID 但没有可读取的会话证据

> 文档类型：Finding
> 状态：Confirmed / TASK-0076
> 发现日期：2026-08-26

## 现象

`TASK-RCV-20260826114418-01-ROLE-RECOVERY` 的 Trace 正确列出 7 个真实 Role Run、Provider Session ID 和 Session URL，但 `/session` 全部返回 `UNAVAILABLE`，`/timeline` 全部返回 `SESSION_EVIDENCE_NOT_FOUND`。其他 W09 Framework Matrix 任务存在同类现象。

## 根因

真实 Role Runtime 总是记录 Provider Session ID，但只有 Workflow Input 显式提供 `sessionEvidence` 时才执行受管 Transcript Capture。W09 Recovery/Framework harness 仅为专门的 `SESSION_CAPTURE_RECOVERY` 场景启用该配置，其他真实多 Agent 场景没有绑定 `sessionEvidence`。最终 GA Service 又只允许 `.moye-runtime` 作为 Session Source Root，无法对现有 Codex/Claude 源文件执行 append-only 历史补全。

## 影响

Task 状态、Role Attempt、Git、测试、Closure 和 Archive 证据不受影响；但角色与交付物 Tab 暴露了不可读取的 Session 入口，用户无法查看 Prompt、Assistant 和工具时间线。此前以 LIVE-006 的历史补全结果代表所有任务可读，验收覆盖不足。

## 正确处置

- 新真实 Agent 产品/故障验收默认启用受管 Session Evidence，专门的 Capture 故障场景只额外注入中断；
- 验收 Service 显式配置 Provider Session Source allowlist；
- 对仍能定位 Provider 源文件的既有归档 Task 使用 `TranscriptEnrichmentWorkflow` 和 `SessionEvidenceRegistry` 追加 Sidecar，不编辑原 Projection；
- 源文件已不存在时保持明确 `UNAVAILABLE`，不得伪造聊天记录。
