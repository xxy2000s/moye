# TASK-0047 Verification

> 状态：Accepted
> 验证日期：2026-08-24

## 证据结论

本 Task 验收的是审计门禁本身，不是新一轮真实 Agent 故障矩阵。审计入口只读取调用方显式列出的 suite/scenario；每个场景重新查询真实 `CoreV2Workflow`、`TaskAuthority` 与 Board Trace，并检查隔离 Git、Role/Test Artifact、Closure、Archive 及 Document Graph。它不会扫描目录、选择“最新成功”、改写 ProjectBoard 或把旧 summary 提升为产品证据。

## Requirement → Test → Execution → Evidence

| Requirement | Test / Execution | Evidence | 结果 |
|---|---|---|---|
| REQ-0047-01/06 | `tests/unit/core-v2-matrix-audit.test.ts` | 4 tests：拒绝空/重复显式输入；统一报告内容寻址；坏证据产生稳定 Finding | PASS |
| REQ-0047-02/03/05 | 对历史四套 suite、14 个场景运行 `npm run acceptance:core-v2:audit -- --file .moye-runtime/TASK-0047-legacy-matrix-audit-input.json --output .moye-runtime/TASK-0047-legacy-matrix-audit-report.json` | Audit input 文件 SHA-256 `52aeac…05e5`；报告文件 SHA-256 `210776…5bb5`；报告 digest `sha256:59ed1a0a8ad54974250d89f617e1c8b9cf0d0b615718a53b83adf21905c3e6e7` | PASS（门禁按预期 exit 1）：25 Findings，拒绝 11 个无 `validationKind` 的旧 suite 与 14 个无显式 `acceptanceMetadata` 的旧 Task |
| REQ-0047-04 | 同一审计逐 Task 实时调用 Restate、Authority 和 Board Trace | 14 个 Task 均查询到与历史证据一致的 `CLOSED + ARCHIVED` outcome；任何实时状态漂移会生成 Finding 或直接失败 | PASS |
| REQ-0047-05 | 审计 14 个场景目录内真实 repository、Role/Test Manifest 与内容摘要 | 除显式产品声明/绑定外，旧分项证据的 Git/Artifact/Attempt/Session/Checkpoint/Test/Merge 专属约束通过；无目录发现 | PASS |
| REQ-0047-07 | 审计 `task-0046-manifest` 的 path/status/index；运行文档图校验 | `controlPlaneFindings=[]`；TASK-0046 节点为 `archived` 且由 `archived-tasks-index` 索引 | PASS |
| REQ-0047-08 | `npm run check` | 37 个单元测试文件 / 220 tests；438 documents / 670 relations | PASS |
| REQ-0047-08 | `npm run test:e2e` | 12 个真实隔离 Restate E2E 文件 / 31 tests | PASS |

## 首次审计的正确解释

旧 14 场景的实时 Runtime 终态仍可查询，并不等于它们满足新的统一产品矩阵契约。审计报告 `passed=false` 是预期且必要的 fail-closed 结果：历史 suite 与 Task Input 缺少当时尚未实现的显式产品验收绑定，不能事后修改 summary、Task Input 或 Projection 来制造通过。TASK-0048 必须使用新的 Workflow key 重新创建所有场景，随后取得零 Finding 报告。

## 剩余边界

- 本 Task 没有运行新的 Codex 场景，不是“完整矩阵通过”证据；
- 全新 14 个执行场景、覆盖第 15 项 stale fencing 要求、统一成功报告、最终 3000 端口部署和逐场景页面清单由 TASK-0048 完成；
- 完整多 Daemon Lease/Fencing、远程 Git Provider/PR、鉴权、多租户和生产观测仍不属于当前 PoC 已验收能力。
