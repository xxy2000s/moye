# TASK-0076 Design

> 状态：Approved

未来执行路径在 acceptance input builder 中统一生成 `LiveSessionCaptureConfigV1`。Codex 使用显式 `CODEX_HOME/sessions`，Claude 使用显式 Projects Root；Workflow 继续在 Agent 前持久化 Prompt/Locator、Agent 后执行独立 durable Capture。Role Worker Recovery 只终止 Role command，恢复后复用已完成 Role Manifest，再执行/对账 Capture，不能重跑 Agent。

历史路径复用现有 `TranscriptEnrichmentWorkflow/<enrichment-id>` 与 `SessionEvidenceRegistry/<run-id>`。批量入口不扫描目录或猜“最新任务”，只消费显式 Task ID 列表，逐个调用单 Task 验收并生成内容寻址汇总。原 owning Projection 在前后计算 Digest；Sidecar 只有诊断权限，不能推进 Task 状态。

部署时 Provider Source Root 和受管 Artifact Root 分别 allowlist。Board 只通过 Registry 读取已经复制并校验 Digest 的受管 Transcript；Provider Home 永远不成为静态文件根。历史源缺失时记录 `UNAVAILABLE`，UI 继续如实显示不可用而不是回落到伪造对话。

临时 Acceptance Service 注册前记录当前 `CoreV2Workflow` 最高 revision 的 endpoint，并保存新 Deployment ID。清理顺序固定为 `PATCH latest acceptance deployment URI → predecessor endpoint`，确认成功后再停止临时进程；不通过重新 `POST` 旧 URI 猜测路由，也不强制删除 Deployment。
