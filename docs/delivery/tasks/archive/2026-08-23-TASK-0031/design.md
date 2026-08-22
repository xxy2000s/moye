# TASK-0031 Design

新增纯领域模块 `src/domain/lifecycle-artifact.ts`。`LifecycleArtifact` 由公共 Envelope、严格 Producer、Kind-specific Payload、Dependency refs 和两层 digest 组成：Payload 先形成 `contentDigest`，整个 Artifact 再形成 `artifactDigest`。所有构造器归一化数组并深冻结；Parser 从不信任 JSON 重建并比较 Expected Digest。

Dependency policy 固定角色交接：Design 依赖 Spec，Plan 依赖 Spec + Design，Design Review 依赖三项架构产物；Test Plan 依赖 Spec + Design，Test Report 依赖 Test Plan；Final Review 依赖 Docs Impact + Test Report；Knowledge Disposition 可由旁路 Agent 或 Workflow 明确生成。Gate 输入列出所需 Kind、Digest 和 Subject Commit，拒绝旧 Revision、跨 Task、重复 Kind 和 stale digest。
