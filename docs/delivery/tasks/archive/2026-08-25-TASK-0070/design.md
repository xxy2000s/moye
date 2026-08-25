# TASK-0070 Design

> 状态：Approved

新增纯执行边界 `documentation-policy.ts`：先用 Git `base..candidate` 得到 changed files，再按 policy 产生 `PASSED | BLOCKED` Evidence，并以 content-checked `wx` 写入 Task Artifact namespace。`none` 是系统明确处置；`conventional` 使用冻结规则；`moye-doc-graph/custom` 通过 `spawn(executable, argv, {shell:false})` 运行，Evidence 保存 argv、cwd、exit code 和输出摘要/Digest。

Client 把 Manifest 相对 cwd 映射到私有 Workflow policy input。Core v2 对新输入在 Documentation Agent PASS 后执行 durable policy gate，BLOCKED 复用既有 REPAIR；PASSED Evidence 转为 `DocsImpactPayload`。旧 Workflow Input 没有该字段时完全保持原 Agent deliverable 路径，避免升级重放插入新的 durable command。
