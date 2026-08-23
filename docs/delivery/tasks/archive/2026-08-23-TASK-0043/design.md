# TASK-0043 Design

验收矩阵使用真实产品 `CoreV2Workflow`，不接入 Scenario Adapter。新增 acceptance harness 负责创建独立临时 Git 仓库、真实测试脚本、Artifact Root、Restate 容器和 Moye Service，再以 `CODEX_EXEC` 提交每个独立 Task。Harness 只收集 Runtime/Board/Git 证据并断言唯一性，不写 Projection。

为使 Finding 场景可重复，输入可携带窄化的 `acceptanceControl.profile`。该字段仅在显式 `MOYE_ACCEPTANCE_FAULT_INJECTION=enabled` 的 Service 中生效，只向指定 Revision/Generation/Phase 的真实 Agent Prompt 附加受控条件，例如让 Generation 0 留下可验证缺陷或要求 Reviewer 审查已注入缺陷。Role Runtime、Codex 进程、Session/Event、Git Checkpoint、Trusted Runner、Review Artifact、Gate、Merge、Closure 和 Archive 均保持真实路径；普通产品 Service 拒绝该字段。

Evidence auditor 从最终 Projection、Board Trace、Role Manifest、Trusted Runner Manifest 和 Git DAG 建立结构化场景摘要。它按 Revision/Generation 检查 Attempt/Session 唯一性、旧 Artifact invalidation、最终 Gate binding、测试执行次数、Candidate/merge 数量和 Projection/Event 一致性。该 Task 不覆盖 UNKNOWN、Worker kill、预算与 stale Attempt；这些保留给后续 Task。
