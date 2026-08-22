# TASK-0030 Verification

> 状态：Accepted

| Requirement | Test | Evidence |
|---|---|---|
| REQ-0030-01/02 | Architecture/ADR Graph 与一致性检查 | `docs_graph.rb validate`：275 documents / 459 relations / 175 Markdown；ADR-0005/0006 Accepted |
| REQ-0030-03/04/05 | Seal domain/unit + CLI/Workflow | `tests/unit/sealed-result-commit.test.ts`；HEAD、唯一父提交、Intent、Archive package、Accepted Verification、Docs Impact 和 clean worktree 均为硬门禁 |
| REQ-0030-06 | 真实 Git + Restate E2E、全库 check | `npm run check`：29 files / 162 tests；`npm run test:e2e`：5 files / 18 tests；真实 Restate E2E 覆盖等待时 SIGKILL、稳定 Intent、错误 token、唯一 Git Commit、重复 Evidence、Board/Trace 与关闭后零写入 |

## 剩余限制

- 本 Task 冻结 5+1 架构并实现仓库自举 Seal；五类主流程 Agent 的统一产品 Workflow 按 TASK-0031 至 TASK-0039 继续实现。
- Task package 永久记录 `seal_prepared` 而不是 Result SHA；Result Commit、Package Digest 和最终 Outcome 存在 `SealedTaskWorkflow` Receipt，避免 Commit 自引用。
