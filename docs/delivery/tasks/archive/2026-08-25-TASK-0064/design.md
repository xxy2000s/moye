# TASK-0064 Design

`TranscriptEnrichmentWorkflow/<enrichment-id>` 是独立、一次性的 durable Sidecar Workflow。它先通过 `TaskAuthority` 解析 owning Core v2 Workflow，再读取已归档 Projection，按 `runId` 定位唯一 Role Manifest，计算 Projection、Domain Event History 与 Role Manifest Snapshot Digest，并由系统生成 `HistoricalEnrichmentBaselineV1`。调用方只提交 Task、Run、Provider allowlist、受管 Artifact Root、Capture policy 与可选 legacy Prompt observation，不拥有 baseline。

`SessionEvidenceRegistry/<run-id>` 是 append-only Virtual Object，保存 W01 已定义的 `SessionEvidenceAuthorityV1`。Workflow 先 claim 当前 Capture Intent，再执行与 live capture 相同的 Provider Adapter/managed Artifact Effect，最后记录 Receipt；同 Intent/Receipt 重放收敛，不同 Digest 或跨 Attempt target 复用 fail closed。Registry 只发布只读查询，不能调用 Task Workflow、Gate、Merge、Closure 或 Archive。

Board 从 Core v2 Projection 得到精确 Role Run 后，以 `runId` 查询 Registry；有历史 Sidecar 时把 Registry head Receipt 解析成只读 resolver input，没有时保持 `UNAVAILABLE`。所有 join 都由 Runtime key 完成，不从目录发现事实。Capture 后 Workflow 再查询 source Projection 并比较冻结 baseline，证明旧 Task 历史没有变化。

首版历史补全支持 Core v2 原始 Workflow 和合法 failure-recovery successor 的只读 Projection。LIVE-006 使用 `full`、真实 Codex rollout 和 `PROVIDER_NATIVE_OBSERVED`（仅当 execution intent 与 Provider Prompt 精确绑定）；无法证明 Prompt 时降级为 `UNVERIFIED`，不能构造 Prompt Envelope。
