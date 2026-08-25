# Core v2 Role Session 只保存 CLI stdout，缺少完整 Prompt 与 Provider 原生时间线

> 文档类型：Finding
> 状态：Resolved by TASK-0058～TASK-0065
> 发现日期：2026-08-25
> 影响范围：Core v2 Role Runtime、Agent Evidence、Artifact、Board Agent Events

## 观察

Core v2 生成真实 Role Prompt 后，只把 `instructionsDigest` 写入 execution intent；Role `events.jsonl` 来自 `codex exec --json` 或 Claude `stream-json` stdout。Board 又使用独立启发式分类器解释这些行，因此页面展示的是 CLI execution stream，不是 Provider 原生 Session Transcript。

以真实 `LIVE-006` Architect Session 为例，Moye Event Artifact 有 9 条记录、6,706 字节；同一 Session ID 对应的 Codex rollout 有 23 条记录、92,995 字节，并包含完整 Role Prompt、developer/user/assistant 消息、逐条时间戳和工具关系。`LIVE-006` 七个 Role Session 的原生文件当前 7/7 仍可定位；原 Moye Artifact 的文件字节、Manifest 数量和 Digest 均一致，说明缺口位于采集源层级，不是现有 Artifact 被截断或篡改。

同时，Board 请求历史事件时还可能因 `MOYE_ARTIFACT_ROOTS` 未包含对应 `.moye-runtime` 而返回 404。Allowlist 缺失与 Transcript 信息不完整是两个不同问题，不能通过放宽目录扫描来混合修复。

## 影响

- 页面无法可靠展示用户 Prompt、系统管控、完整工具结果、stderr、父子 Session 和真实时间关系；
- 三套解析逻辑可能把同一 Provider 记录分类为不同 UI 事件；
- Core v2 只在 Role 完成后发布 Run Evidence，Agent 运行时缺少可查询的 active locator；
- Provider Home 文件清理后，Moye 无法从自己的受管 Artifact 恢复完整 Session；
- 把 stdout Viewer 称为完整 Agent Session 会超过当前证据范围。

## 边界

修复不能让 Board 在请求时扫描 `~/.codex` 或 `~/.claude`，不能修改旧 Role Manifest、Task Projection、Domain Event、Outcome 或 Archive，也不能在 Transcript capture 失败时重新运行 Agent。

实施工作进入 [BL-0069](../../delivery/backlog/BL-0069.yaml)，并由 [M1 Agent Session Evidence](../../delivery/milestones/m1-agent-session-evidence.md) 分阶段验收。

## Resolution

M1 已完成 Prompt Envelope、Codex/Claude 原生 Session Adapter、Core v2 durable Capture、统一 Timeline/Board API、Chatbot UX 与历史 append-only Enrichment。最终门禁用本轮真实 Codex Session `01a03ae1-7f4c-7bc0-affe-067f02482db9`、真实 Claude Session `2c28cacf-461c-497b-93d1-f10fa55cc551`、七角色 Capture Recovery Task `TASK-RCV-20260825190550-01-SESSION-CAPTURE` 和 LIVE-006 七个历史 Receipt 通过，聚合报告 Digest 为 `sha256:7a9e335a934849935c4a2802b8467e804e731dbbd7816433ee92ff93c1055854`。

原 Finding 已解决，但生产鉴权、保留/删除、远端 Artifact Store 和 Provider 未暴露或加密内容属于明确剩余限制，不因本 Finding 关闭而视为完成。
