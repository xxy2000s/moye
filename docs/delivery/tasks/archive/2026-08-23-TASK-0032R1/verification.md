# TASK-0032R1 Verification

> 状态：Accepted

| Requirement | Test | Evidence |
|---|---|---|
| REQ-0032R1-01/02 | Projection/Authority successor tests | `tests/unit/task.test.ts`；旧失败终态不可复活，successor 追加历史；真实 TASK-0032 保留两段失败后唯一成功链尾 |
| REQ-0032R1-03/04/07 | historical Seal Gate | `tests/unit/sealed-result-commit.test.ts`：旧 Result 必须为 HEAD 祖先，并在目标 Commit detached worktree 校验其 Docs Impact |
| REQ-0032R1-05/06 | real Restate recovery | `tests/e2e/restate-recovery.test.ts`：错误 SHA 形成原失败；真实 successor 重新校验 Git 并由 Authority/Board/Trace 解析；持久 Runtime 中 TASK-0032 最终 `SUCCEEDED + ARCHIVED` |

## 全库证据

- `npm run check`：31 test files / 176 tests；文档图谱 295 documents / 488 relations / 188 Markdown；
- `npm run test:e2e`：7 files / 23 tests；
- Runtime：TASK-0032 Event 1～13 保留错误 Evidence、失败 recovery 和最终 `SealCommitVerified → SUCCEEDED → ArchiveArchived`；
- Knowledge Disposition：`applied`，真实故障已写入 Incident，稳定陷阱已提升为 Durable Runtime Pitfall #15，并更新 Architecture/Runbook/CodeMap。
